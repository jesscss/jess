# Canonical AST visitation design

Status: reviewed direction, revised after adversarial review. This supersedes
the prior value-dimension-only proposal; `forEachDimensionInValueSlot` is
rejected as too overfit. Implementation still requires the tests/gates below.

## 1. Problem

`@jesscss/lint` and the language service need the same problem detectors. The
lint package should own configuration, severity policy, output formatting, and
CLI/editor presentation. It should not own unique problem detection.

The common detector layer needs a real canonical traversal shape. The immediate
symptom was CSS `zero-units` in `packages/diagnostics-core/src/tolerant-cst.ts`
walking declaration values with diagnostics-local `Object.values(...)`. Replacing
that with `forEachDimensionInValueSlot(...)` would remove one bad crawl but leave
the architecture wrong: it hard-codes one detector instead of defining how Jess
code observes canonical AST facts.

The design must serve two related but different needs:

- **Authored canonical visitation**: read-only traversal over the AST v2 source
  tree for diagnostics, language-service facts, refactors, and lint migration
  rules.
- **Eval/render visitation**: hooks at the points where eval/render already
  visits resolved nodes or values, without adding a second walk or materializing
  output trees.

The shared piece is vocabulary and child-edge ownership, not a single Less-style
visitor ABI.

## 2. Current Evidence

- AST v2 in `packages/core/src/ast/nodes.ts` is plain data: PascalCase `type`,
  no base class, no `new`, no methods on nodes.
- Value leaves are already cheap authored objects. A dimension is currently
  `Dimension { type, number, unit, src }`, not a string that needs lint to
  materialize it.
- `packages/core/src/ast/serialize.ts` still has materialization, but that means
  "turn an authored AST value into a value-domain object for eval semantics."
  Authored diagnostics do not need value-domain materialization.
- Eval may materialize cheap typed leaves at existing resolution points even in
  value emission, for example `Dimension` can become a value-domain dimension
  when an evaluator exists. The important boundary is that diagnostics do not
  force this materialization.
- The older plan to store literals as strings plus side-table type tags is
  historical context, not the current shape. If that lane is revived for
  allocation reasons, traversal should expose the same authored facts through a
  core-owned view so diagnostics do not care whether a dimension is an object or
  a string/tag pair.
- The current render hook in `packages/core/src/context.ts` is an emit-time hook
  over resolved legacy output `Node`s. It has the right performance instinct:
  zero cost when unregistered and no whole-tree output walk. Its implementation
  name should not become the general API.
- Less 4 visitors are a compatibility ABI with `visit${Type}`,
  `visit${Type}Out`, `visitArray`, `isReplacing`, `visitDeeper`, and node-owned
  `accept(visitor)`. That is a separate bridge problem.
- The removed Jess visitor ABI had `ABORT`, `REMOVE`, `SKIP`, per-type methods,
  `enter`/`exit`, and a `TreeVisitor` auto-walk over legacy `Node`s. It should
  not be recreated for AST v2.

## 3. Design Goals

- One detector implementation feeds both language service diagnostics and
  `@jesscss/lint`.
- Parser packages remain recognizers/builders. They do not run CSS metadata
  checks, custom-property checks, unknown-property checks, duplicate policies, or
  lint rules in grammar reductions.
- Authored traversal is typed and explicit: no diagnostics-local object crawls,
  no `Object.values(...)`, no structural rediscovery.
- Eval/render visitation is pass-integrated: the pass that already resolves or
  emits a node is the driver. No new whole-tree render walk.
- No AST node methods, no `accept()`, no Less-shaped wrappers, and no per-type
  `visitFoo` public surface.
- No parse/eval/render hot-path cost when visitation is not requested.
- The design remains compatible with current cheap value-node objects and with a
  possible future string/tag representation.

## 4. Phase Model

Jess should have one traversal vocabulary with phase-specific authority:

| Phase | Driver | Sees | May replace? | Normal consumers |
|---|---|---|---|---|
| `authored` | self-driven canonical AST walk | parsed source AST facts | no | diagnostics, LS, lint, refactors |
| `eval` | existing eval/value-resolution pass | authored values plus resolved values at existing call sites | no | semantic facts, telemetry, future compiler metadata |
| `emit` | existing render/output pass | resolved output node/value at serialization edge | yes, only through explicit output-transform hook | Less compat proof plugins, output transforms |

The phases share node-kind names, child-edge names, and source-span helpers. They
do not share authority. A read-only authored diagnostic hook must not inherit
emit replacement semantics. An emit transform must not self-drive a second
authored walk.

## 5. Authored Traversal Surface

Add a canonical traversal module owned by core AST, but keep initial exports
internal until a package-boundary decision is reviewed.

Authored traversal has three target families because the current AST has three
real shapes:

- typed AST nodes with `type`;
- recursive `ValueSlot` arrays, which are semantic structure but not nodes;
- guard nodes with `g`, not `type`.

Shape:

```ts
export type AstVisitNode =
  | Stylesheet
  | Statement
  | ValueNode
  | SelectorList
  | ComplexSelector
  | CompoundSelector
  | SimpleToken
  | AtRuleBlock
  | AtRuleStatement
  | ImportAtRule
  | Plugin
  | OpaqueAtRuleBlock;

export type AstEdge =
  | 'root'
  | 'stylesheet.children'
  | 'rule.selector'
  | 'rule.guard'
  | 'rule.body'
  | 'declaration.value'
  | 'value-slot.item'
  | 'value.list.item'
  | 'value.operation.left'
  | 'value.operation.right'
  | 'selector.pseudo.args'
  | 'guard.cmp.left'
  | 'guard.cmp.right'
  // closed table in implementation; see edge matrix below.

export interface AstCursor {
  readonly phase: 'authored';
  readonly edge: AstEdge;
  readonly parentKind: 'node' | 'slot' | 'guard' | null;
  readonly parent: AstVisitNode | readonly ValueSlot[] | GuardNode | null;
  readonly index: number;
  readonly depth: number;
}

export type AstVisitDecision = void | 'skip-children';

export interface AstVisitHooks {
  enterNode?(node: AstVisitNode, cursor: AstCursor): AstVisitDecision;
  leaveNode?(node: AstVisitNode, cursor: AstCursor): void;
  enterSlot?(slot: readonly ValueSlot[], cursor: AstCursor): AstVisitDecision;
  leaveSlot?(slot: readonly ValueSlot[], cursor: AstCursor): void;
  enterGuard?(guard: GuardNode, cursor: AstCursor): AstVisitDecision;
  leaveGuard?(guard: GuardNode, cursor: AstCursor): void;
}

export function walkAuthoredAst(root: Stylesheet, hooks: AstVisitHooks): void;
export function walkAuthoredValue(value: ValueSlot, hooks: AstVisitHooks): void;
```

Important details:

- Consumers switch on `node.type` for typed nodes and `guard.g` for guards. Core
  does not provide `dimension?`, `declaration?`, or `visitDimension` methods.
- `ValueSlot` arrays are first-class traversal targets via `enterSlot` /
  `leaveSlot`. A root `ValueSlot` array is entered with edge `root`.
- `AstCursor` is reusable traversal state. Cursor fields are valid only during
  the synchronous callback currently receiving it. Consumers must copy any cursor
  fields they retain.
- `skip-children` is allowed for read-only pruning. It is not Less
  `visitDeeper`: there is no mutation, replacement, flattening, or node-owned
  `accept()`.
- No callback can replace, remove, insert, or reorder authored AST nodes.
- Child ownership is explicit in core switches. A new AST node or child field
  fails traversal tests until its edge is classified.
- `walkAuthoredValue` is not dimension-specific. It exists because values are a
  natural boundary for diagnostics and semantic facts.

This is a traversal surface, not a materialization surface. A diagnostic that
wants dimensions reads the current cheap `Dimension` object. If a future
string/tag lane removes that object, this module becomes the compatibility layer
that yields the same authored fact to consumers.

## 6. Child Edge Matrix

Core must own the child-edge table. Consumers must never recurse with
`Object.values(...)`.

### Value Slots And Values

| Shape | Authored child edges |
|---|---|
| `ValueSlot[]` | `value-slot.item` for each item |
| `Keyword`, `Color`, `Quoted`, `Any`, `Comment`, `SelectorCapture` | none |
| `Url` | `value.url.value` |
| `SpacedValue`, `Sequence` | `value.parts` for each part |
| `List` | `value.list.item` for each item |
| `Important`, `Block` | `value.inner` |
| `Operation` | `value.operation.left`, `value.operation.right` |
| `FunctionCall` | `value.function.arg` for each arg |
| `Interpolation` | `value.interpolation.ref` for every part with `ref` |
| `GeneralEnclosed` | `value.general.content` |
| `VarIndirect` | `value.var-indirect.name` |
| `Condition` | `value.condition.guard` |
| `Reference` | `value.reference.base`; `value.reference.bracket-key` for value keys; `value.reference.call-arg` for call args whose values are `ValueSlot` |
| `Range` | `value.range.start`, `value.range.end`, `value.range.step` when present |
| `Collection` | `value.collection.base` when present; `value.collection.entry` for declaration/variable entry values |
| `AnonymousMixin` | `value.anonymous-mixin.param-default`, `value.anonymous-mixin.param-pattern`, `value.anonymous-mixin.body` |

### Guards

Guards are not `node.type` nodes. They are traversed through `enterGuard` and
`guard.g`.

| Guard shape | Authored child edges |
|---|---|
| `cmp` | `guard.cmp.left`, `guard.cmp.right` |
| `and`, `or` | `guard.logical.left`, `guard.logical.right` |
| `not` | `guard.not.inner` |
| `truth` | `guard.truth.value` |
| `call` | `guard.call.arg` for each arg |
| `default` | none |

### Statements And At-Rules

| Shape | Authored child edges |
|---|---|
| `Stylesheet` | `stylesheet.children` |
| `Rule` | `rule.selector`, `rule.guard` when present, `rule.body`; `extendInstructions` are selector facts, not statement body |
| `Declaration` | `declaration.value` |
| `VariableDeclaration` | `variable.value` when value is `ValueSlot`; `variable.mixin-call` when value is `MixinCall` |
| `MixinDef` | param defaults/patterns, `mixin.guard`, `mixin.body` |
| `MixinCall` | `mixin-call.arg` for each arg value; path segments are raw selector/name facts |
| `Apply` | `apply.selector` |
| `For` | `for.iterable`, `for.body` |
| `If` | `if.branch.guard`, `if.branch.body` |
| `StyleImport`, `ModuleImport` | import paths are typed `Quoted` values where modeled; import specifier names are raw facts |
| `AtRuleBlock` | `atrule.prelude` when present, `atrule.body` |
| `AtRuleStatement` | `atrule-statement.prelude` when present |
| `ImportAtRule` | `import.options`, `import.target`, `import.alias`, `import.tail` when present |
| `Plugin` | `plugin.target`, `plugin.options` when present |
| `FunctionCall` as statement | same as value `FunctionCall` |
| `Reference` as statement | same as value `Reference` |
| `Comment`, `RawInline`, `OpaqueAtRuleBlock` | terminal; raw text/body is not traversed |

### Selectors

| Shape | Authored child edges |
|---|---|
| `SelectorList` | `selector.branch` |
| `ComplexSelector` | `selector.head`, `selector.tail.compound` |
| `CompoundSelector` | `selector.simple` |
| `SimpleSelector` | `selector.simple.interp` when present |
| `PseudoSelector` | `selector.pseudo.interp` when present; `selector.pseudo.args` when structured |

Memo/cache fields such as `_canon`, `_hasAmp`, `_hasInterp`, raw text fields,
names, flags, `src`, `unit`, and `number` are facts, not child edges.

## 7. Authored Diagnostics Flow

Clean CSS:

1. parse canonical CSS AST;
2. run shared diagnostics collectors over `walkAuthoredAst`;
3. collectors observe typed facts (`Declaration`, `Dimension`, `AtRuleBlock`,
   selectors, etc.) and source spans;
4. language-service and lint adapters apply policy/presentation.

Invalid CSS or recovery-heavy text:

1. parse tolerant CST;
2. report parse diagnostics;
3. run tolerant CST collectors where canonical AST facts are unavailable.

Less/SCSS/Jess:

- use authored traversal for syntax facts that do not require evaluation;
- semantic diagnostics wait for compiler/language-service facts rather than
  duplicating eval in lint;
- detectors can prune deferred semantic edges with `skip-children` until the
  dialect has reviewed what authored facts should mean.

For `zero-units`, the collector is just one consumer:

- on `enterNode`, if `node.type === 'Dimension'`, check `number === 0` and unit
  policy;
- use source-span mapping below;
- emit the shared diagnostic code;
- lint may disable/demote/promote it; the language service sees the same
  detector output.

## 8. Eval/Render Visitation

Eval visitation uses the same edge names where possible, but it is not a
self-driven authored AST walk. It is an observer list invoked by existing pass
points only when registered.

Initial eval observer surface is internal and synchronous:

```ts
export interface EvalCursor {
  readonly phase: 'eval';
  readonly edge: AstEdge;
  readonly lane: 'value' | 'typed' | 'statement' | 'guard';
  readonly origin: 'authored' | 'synthetic';
  readonly authored: AstVisitNode | readonly ValueSlot[] | GuardNode | null;
}

export interface EvalVisitHooks {
  beforeValueSlot?(slot: ValueSlot, cursor: EvalCursor): void;
  afterValueSlot?(slot: ValueSlot, resolved: Value | ValueGroup, cursor: EvalCursor): void;
  beforeValueNode?(node: ValueNode, cursor: EvalCursor): void;
  afterValueNode?(node: ValueNode, resolved: Value | ValueGroup, cursor: EvalCursor): void;
  beforeStatement?(node: Statement, cursor: EvalCursor): void;
  afterStatement?(node: Statement, cursor: EvalCursor): void;
}
```

Exact event map for a future eval-observer slice:

| Call site | Event | Semantics |
|---|---|---|
| `evalValueSlot` entry for `ValueSlot[]` | `beforeValueSlot`, lane `value` | observes authored array before slash promotion or child resolution |
| `evalValueSlot` completion | `afterValueSlot`, lane `value` | observes resolved `Value`; if the result is thenable, fires in the continuation |
| `evalTypedSlot` entry for `ValueSlot[]` | `beforeValueSlot`, lane `typed` | observes authored array before typed child resolution |
| `evalTypedSlot` completion | `afterValueSlot`, lane `typed` | observes resolved `ValueGroup`; continuation-preserving for `MaybePromise` |
| `evalValue` entry for scalar `ValueNode` | `beforeValueNode`, lane `value` | observes scalar authored node or synthetic node with `origin` set |
| `evalValue` completion | `afterValueNode`, lane `value` | observes resolved value without forcing extra materialization |
| `evalTyped` entry for scalar `ValueNode` | `beforeValueNode`, lane `typed` | observes typed-resolution entry |
| `evalTyped` completion | `afterValueNode`, lane `typed` | observes resolved `ValueGroup` |
| statement loops in `emitNestedBody` and `emitAtRuleBody` | `beforeStatement` / `afterStatement`, lane `statement` | observes statements as the render/eval pass already reaches them; async children fire `after` in their completion continuation |

Rules:

- Hooks are synchronous. They may throw, and throws follow the existing error
  path. They must not return promises.
- Hook dispatch has a zero-registered fast path.
- Hook dispatch must not materialize value-domain objects just to notify a hook.
  It can only pass values the existing eval path already produced.
- Synthetic nodes created by existing normalization, such as slash promotion,
  are marked `origin: 'synthetic'`. Consumers that want authored-only facts must
  ignore them.
- Some internal helper evaluations may intentionally remain unobserved until a
  concrete consumer needs them. The implementation must document each skipped
  site next to the event map.
- Eval observers cannot replace output. Compiler-internal transforms need a
  separate design.

Emit/output transforms remain an output phase surface:

```ts
export type OutputTransformEnter = (node: Node) => Node | void;
```

That existing shape is allowed to replace because it operates at the resolved
serialization edge. It should be renamed away from implementation vocabulary in
a later cleanup, but not folded into authored diagnostics.

## 9. Materialization Decision

Do not resurrect the string-plus-side-table literal plan for lint.

Current AST v2 already gives diagnostics cheap typed authored facts:

- `Dimension` has `number`, `unit`, and `src`;
- `Color` and `Quoted` keep parsed fields;
- `Any` is the intentionally opaque fallback.

Value-domain materialization remains an eval concern. It happens where existing
eval semantics need a `ValueObj` or typed evaluator result, including some value
emission paths. Authored diagnostics do not call materializers and do not depend
on value-domain objects.

The traversal API should phrase its contract in terms of authored facts, not
allocation shape. Today that fact is a cheap object. If a future performance lane
proves literal objects should be replaced by strings plus tags, core traversal
owns the compatibility view and diagnostics do not change.

## 10. Source Spans

Diagnostics should prefer parser-authored side-table spans:

1. Use `sourceSpanOf(node)` when present and inside the relevant source window.
2. For `ValueSlot` arrays or nodes without spans, use a monotonic locator scoped
   to the owning declaration/prelude/body window.
3. The fallback locator must be token-aware for presentation: skip strings and
   comments, respect CSS token boundaries, and scan forward from the previous
   match in that same value window.
4. If no exact token range is found, do not emit a guessed AST diagnostic for
   that leaf. Missing one hint is better than underlining the wrong source.

Longer term, if span lookup becomes measurable cost or too ambiguous, design a
parser/Parseman span mode separately. Do not add parser work in the lint slice.

The fallback locator should be a core-owned helper used by diagnostics and LS
callers. It should not be reimplemented in lint.

## 11. Less Visitor Compatibility

Less visitor compatibility remains separate.

A real Less bridge needs:

- Less-shaped lazy facades;
- `accept(visitor)` on facades, not on canonical AST nodes;
- `visitArray`;
- `visit${Type}` and `visit${Type}Out`;
- `isReplacing`;
- conversion from Less replacement values back into Jess values;
- pre-eval visitor support if that compatibility surface is accepted.

The bridge should be guided by a tracking table of visitor shapes actually used
by published Less packages. That table is evidence, not a ceiling: Jess may
support shapes beyond the observed corpus when they are cheap, coherent, or
needed for compatibility goals. But every supported visitor affordance should be
traceable to either an observed package shape or an explicit owner decision.

The tracking table should record at least:

| Field | Purpose |
|---|---|
| package/version | pins the observed public package behavior |
| visitor entrypoints | `install`, `manager.addVisitor`, `isPreEvalVisitor`, direct `visitors.Visitor`, etc. |
| methods used | `visitRuleset`, `visitDeclaration`, `visitRuleOut`, generic `run`, and so on |
| traversal controls | `visitArgs.visitDeeper`, `node.accept`, `visitor.visitArray`, non-replacing arrays |
| replacement behavior | returns same node, new Less node, `undefined`, array/flattened output |
| node surface read/written | selector fields, declaration value/name, rules arrays, visibility flags, imports |
| phase | pre-eval, eval/render, postprocessor-like, unknown |
| Jess decision | support now, support later, reject, or emulate through a narrower native hook |

The canonical traversal vocabulary may help the bridge find authored children,
but it is not the Less visitor ABI and should not expose Less control semantics.

Current active coverage still treats Less visitors as unsupported/todo/skipped,
so implementing the canonical traversal must not claim to close that gap.

## 12. Implementation Slices

### Slice 1: Authored Traversal, Internal

- Add the generic authored traversal module.
- Keep it internal to packages that need it unless a package-export review
  explicitly approves public `@jesscss/core/ast` exposure.
- Replace diagnostics-core's value `Object.values(...)` crawl with
  `walkAuthoredValue` or `walkAuthoredAst`, not a dimension-specific helper.
- Add traversal exhaustiveness tests and source-location tests.
- Do not edit parser package source.
- Do not edit eval/render hooks.

### Slice 2: Diagnostics Consolidation

- Move CSS lint collectors onto authored traversal.
- Ensure language service and `@jesscss/lint` consume the same collector output.
- Keep lint configuration as policy/presentation only.
- Keep CST fallback for invalid/recovery text.

### Slice 3: Eval Observer

- Add eval observers only after a concrete semantic-fact consumer needs them.
- Implement the exact event map in section 8, or update and re-review that map
  before coding.
- Preserve `MaybePromise` behavior: after-hooks fire in the same sync or async
  completion lane as the value/statement they observe.
- Preserve the zero-registered fast path.

### Slice 4: Emit Hook Cleanup

- Rename the current output hook away from implementation-specific vocabulary if
  it remains part of the supported surface.
- Preserve the zero-registered fast path and no-second-walk rule.

## 13. Tests And Gates

Before implementation:

- adversarial review recorded below;
- review blockers resolved in this document.

For Slice 1:

- traversal tests prove source order, `skip-children`, cursor lifetime notes,
  root `ValueSlot[]` behavior, and exhaustive edge classification;
- tests prove memo/cache/raw fields are not traversed;
- guard tests prove `guard.g` traversal, not fake `node.type` traversal;
- source-location tests cover duplicate values, substring traps, quoted strings,
  comments, and repeated zero dimensions;
- diagnostics-core tests prove findings are unchanged;
- language-service lint-rule tests prove IDE diagnostics use the same detector
  path;
- lint tests prove policy/presentation remains in `@jesscss/lint`;
- no parser package source diff against `origin/dev`;
- `pnpm run verify:package-exports` if a package boundary is touched;
- `pnpm run verify:types`;
- `pnpm --filter @jesscss/lint bench:stylelint` only after the code is stable,
  and only then claim performance.

For Slice 3:

- event-map tests prove each listed eval call site fires once in the intended
  lane;
- sync and async tests prove `MaybePromise` behavior is preserved;
- tests prove no hook dispatch occurs when no observer is registered;
- tests prove hooks do not force materialization beyond existing eval results.

## 14. Rejected Shapes

- `forEachDimensionInValueSlot`: rejected as overfit to one lint rule.
- Diagnostics-local `Object.values(...)`: rejected because it rediscovers AST
  shape outside core.
- Public optional-method `AstInspector`: too close to visitor-framework gravity
  and too easy to export prematurely.
- Pretending guards are `node.type` AST nodes: rejected; they use `g`.
- Node methods / `accept()`: rejected for canonical AST v2 plain data.
- Reusing emit/output transforms for authored diagnostics: wrong phase.
- Recreating the removed Jess `TreeVisitor`: wrong node model and deleted
  machinery.
- Implementing Less visitor compatibility as part of lint traversal: wrong
  contract.

## 15. Review Record

Adversarial review completed by subagent `019faabd-9cae-7f11-979b-ff414867183a`.
Verdict: reject for immediate implementation, approve the direction.

Findings accepted into this revision:

- Eval visitation was too vague. Section 8 now names exact future event
  call-sites, before/after semantics, `MaybePromise` behavior, and skipped-site
  discipline.
- Guard traversal was internally inconsistent. Guards now use `enterGuard` /
  `leaveGuard` and `guard.g`, not fake `node.type`.
- Root `ValueSlot[]` arrays were underspecified. Slots are now first-class
  traversal targets with `enterSlot` / `leaveSlot`.
- The edge table was illustrative. Section 6 now records the value, guard,
  statement, at-rule, and selector edge matrix.
- The materialization section overstated the split. It now says authored
  diagnostics do not need value-domain materialization, while eval may
  materialize at existing resolution points.
- Cursor reuse needed a lifetime rule. Section 5 now states the cursor is valid
  only during the synchronous callback.
