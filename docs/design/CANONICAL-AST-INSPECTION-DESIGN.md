# Canonical AST visitation design

Status: reviewed direction, implementation blocked until the pre-Slice-1 AST
shape and Less lazy-visitation proof is complete. This supersedes the prior
value-dimension-only proposal; `forEachDimensionInValueSlot` is rejected as too
overfit. Implementation still requires the tests/gates below.

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
- **Less visitor compatibility**: lazy Less-shaped visitor facades built from
  the same canonical child-edge ownership and phase hooks, without forcing eager
  Less tree materialization.

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
  `accept(visitor)`. The Less ABI belongs in a bridge, but the canonical
  traversal design must be strong enough for that bridge to implement those
  shapes lazily.
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
- Less visitor compatibility is a first-class design pressure: canonical edge
  ownership must be sufficient for lazy dispatch, lazy `accept()`/`visitArray`
  facades, and replacement overlays.
- If simple Less visitor shapes are difficult to express from AST v2, treat that
  as evidence that the AST shape or edge model is wrong. The adapter should not
  be forced to compensate for avoidable canonical AST awkwardness.
- No AST node methods, no `accept()`, no Less-shaped wrappers, and no per-type
  `visitFoo` public surface in core traversal.
- No parse/eval/render hot-path cost when visitation is not requested.
- The design remains compatible with current cheap value-node objects and with a
  possible future string/tag representation.

## 4. Phase Model

Jess should have one traversal vocabulary with phase-specific authority:

| Phase | Driver | Sees | May replace? | Normal consumers |
|---|---|---|---|---|
| `authored` | self-driven canonical AST walk | parsed source AST facts | no | diagnostics, LS, lint, refactors, Less pre-eval/lazy facades |
| `eval` | existing eval/value-resolution pass | authored values, resolved CSS values, and resolved semantic values | no | semantic facts, telemetry, Less visitors that need resolved values |
| `emit` | existing render/output pass | resolved output node/value at serialization edge | yes, only through explicit output-transform hook | Less emit visitors, output transforms |

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
  | 'stylesheet.rules'
  | 'ruleset.selector'
  | 'ruleset.guard'
  | 'ruleset.extend.target'
  | 'ruleset.extend.subject'
  | 'ruleset.rules'
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
- The edge table is also the Less bridge's lazy child discovery source. It must
  be stable enough for a facade to implement `accept(visitor)` and `visitArray`
  without eagerly converting a whole subtree, and for the bridge to traverse
  through uninterested ancestors without calling no-op visitor methods.

This is a traversal surface, not a materialization surface. A diagnostic that
wants dimensions reads the current cheap `Dimension` object. If a future
string/tag lane removes that object, this module becomes the compatibility layer
that yields the same authored fact to consumers.

The Less bridge is also a shape test for AST v2. For simple, direct node
families like rules, declarations, at-rules, selectors, dimensions, colors, and
quoted values, lazy Less facade mapping should be boring. If those shapes require
fragile reconstruction, source-string parsing, broad side searches, or eager
subtree conversion, the fix should be considered at the AST/edge level first.

## 6. Child Edge Matrix

Core must own the child-edge table. Consumers must never recurse with
`Object.values(...)`.

### Value Slots And Values

| Shape | Authored child edges |
|---|---|
| `ValueSlot[]` | `value-slot.item` for each item |
| `Keyword`, `Color`, `Quoted`, `Any`, `Comment`, `SelectorCapture` | none |
| `VariableReference`, `PropertyReference` | none |
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
| `Reference` | `value.reference.base` for `ValueNode` or `MixinCall`; `value.reference.bracket-key` for value keys; `value.reference.call-arg` for call args using the shared `CallValue` rule |
| `Range` | `value.range.start`, `value.range.end`, `value.range.step` when present |
| `Collection` | `value.collection.base` when present; `value.collection.entry` for each value-keyed entry |
| `CollectionEntry` | `value.collection.key`, `value.collection.value` |
| `AnonymousMixin` | `value.anonymous-mixin.param-default`, `value.anonymous-mixin.param-pattern`, `value.anonymous-mixin.rules` |

### Call Values

`CallValue` is a real recursive boundary: `ValueSlot | MixinCall`. Traversal
must not assume mixin-call arguments are always value slots.

| Shape | Authored child edges |
|---|---|
| `ValueSlot` | traverse through the value-slot/value rules above |
| `MixinCall` | traverse the `MixinCall` node through the statement/call rules below, with cursor role identifying value/callable position |
| `CallArg` | `call-arg.value`; named/spread flags are facts, not child edges |

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
| `Stylesheet` | `stylesheet.rules` |
| `Ruleset` | `ruleset.selector`, `ruleset.guard` when present, `ruleset.extend.target`, `ruleset.extend.subject` when present, `ruleset.rules` |
| `Declaration` | `declaration.name` when name is `Interpolation`; `declaration.value` |
| `VariableDeclaration` | `variable.value` using the shared `CallValue` rule |
| `MixinDefinition` | param defaults/patterns, `mixin.guard`, `mixin.rules` |
| `MixinCall` | `mixin-call.arg` for each arg using the shared `CallValue` rule; path segments are raw selector/name facts and an AST-pressure item for Less visitor facades |
| `Apply` | `apply.selector` |
| `For` | `for.iterable` using the shared `CallValue` rule, `for.rules` |
| `If` | `if.branch.guard`, `if.branch.rules` |
| `StyleImport` | `style-import.path`; namespace/forward/mode are facts |
| `ModuleImport` | `module-import.path`; import specifier names/aliases are raw facts |
| `AtRuleBlock` | `atrule.prelude` when present, `atrule.rules` |
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

### AST Pressure Register

These are not automatic blockers for authored traversal, but they are design
findings that must be resolved before a Less visitor bridge claims support:

| Shape | Pressure | Current decision |
|---|---|---|
| `Ruleset.extendInstructions` hoisted off `.rules` | good for serializer/extend planning, but Less may expose body-form `Extend` in source-order `rules` | add selector edges now; pre-Slice-1 must prove whether lazy synthetic `Extend` facades are acceptable or AST needs source-order extend placement |
| `MixinCall.name` / `MixinCall.path[].sel` raw strings | fine for current eval, but may force selector reconstruction for Less `Element`/mixin visitor surfaces | block Less visitor bridge until observed plugins prove raw strings are enough or AST carries structured selector/path facts |
| Selector model `SelectorList -> ComplexSelector -> CompoundSelector -> SimpleToken` | modern and parser-friendly, but Less exposes `Selector.elements` / `Element.combinator` / `Element.value` | pre-Slice-1 proof must show `visitSelector` / `visitElement` can be lazy without source reparse or eager synthetic subtree conversion |

Collections are not an AST-pressure item for this design. The design of record
is the value-keyed map model in `docs/design/COLLECTION-VALUE-KEYS.md`:
`Collection.entries` are `CollectionEntry { key, value }` records, both sides are
values, and keys compare by value equality. Traversal should target that model
and should not encode the older declaration-backed collection shape as the
canonical edge contract.

### Parser Construction Pressure

The traversal design must also ask whether the desired node shape falls out of
the grammar naturally. Parser reductions should build canonical AST facts once;
they should not build visitor ABI nodes, run diagnostics, or stringify structured
facts only so a later visitor can parse them back.

Current evidence:

| Shape | Parser pressure |
|---|---|
| CSS `Dimension` | natural: the grammar already reduces number plus optional unit directly to `dimension(Number(numberText), unit, src)` |
| CSS `Declaration` | natural: the grammar already reduces property/custom-property name and structured value into `decl(name, valueSlot(...))` |
| `Ruleset` statement from ruleset syntax | natural for core AST: selector, guard, rules statements, and extend facts are all available in ruleset reductions |
| `SelectorList` / `ComplexSelector` / `CompoundSelector` | mostly natural: selector grammar already produces selector facts directly; Less `Element` compatibility should be a lazy facade over these edges, not a parser obligation |
| `Collection` maps | natural: map grammars already see `key: value` boundaries and should reduce them directly to `CollectionEntry` records with typed value keys |
| SCSS nested properties | natural but role-specific: the grammar sees declaration-shaped leaf names, but this is the structural nested-property role of `Collection`, not evidence that data-map entries should be declarations |
| `Ruleset.extendInstructions` | natural to parse as selector facts, but hoisting body-form extends off `Ruleset.rules` loses the source-order node shape Less visitors may expect |
| `MixinCall.path` / `name` | current parsers deliberately preserve raw selector/name strings for dispatch; if Less plugins need element-level path visitation, the parser can carry structured facts, but the AST must ask for them explicitly |

The rule for implementation: if a desired traversal edge asks a parser to
reparse, broad-search, stringify-and-recover, or manufacture Less visitor shapes,
the edge or AST node is wrong. If the grammar already has the fact at a local
reduction, carrying that fact on the canonical AST is allowed design pressure.

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

The public/design vocabulary must describe Jess concepts, not implementation
function names. Consumers should not need to know what `evalValueSlot`,
`evalTypedSlot`, or `emitNestedBody` are. Those names belong only in the private
implementation map below.

Initial eval observer surface is internal and synchronous:

```ts
export type EvalValueResolution = 'css-value' | 'semantic-value';
export type EvalMoment = 'enter' | 'leave';

export interface EvalCursor {
  readonly phase: 'eval';
  readonly edge: AstEdge;
  readonly moment: EvalMoment;
  readonly origin: 'authored' | 'synthetic';
  readonly parent: AstVisitNode | readonly ValueSlot[] | GuardNode | null;
}

export interface AuthoredValueEvent {
  readonly value: ValueSlot;
  readonly resolution: EvalValueResolution;
  readonly cursor: EvalCursor;
}

export interface ResolvedValueEvent {
  readonly authored: ValueSlot;
  readonly resolution: EvalValueResolution;
  readonly value: Value | ValueGroup;
  readonly cursor: EvalCursor;
}

export interface StatementEvalEvent {
  readonly statement: Statement;
  readonly cursor: EvalCursor;
}

export interface GuardEvalEvent {
  readonly guard: GuardNode;
  readonly cursor: EvalCursor;
}

export interface EvalObserver {
  authoredValue?(event: AuthoredValueEvent): void;
  resolvedValue?(event: ResolvedValueEvent): void;
  statement?(event: StatementEvalEvent): void;
  guard?(event: GuardEvalEvent): void;
}
```

Concepts:

- `authoredValue` fires when eval is about to resolve an authored value shape.
- `resolvedValue` fires when that authored value has produced either a CSS-output
  value (`resolution: 'css-value'`) or a semantic typed value
  (`resolution: 'semantic-value'`).
- `statement` fires when the pass reaches or completes an authored statement.
- `guard` fires when a guard starts or completes evaluation.
- `origin: 'synthetic'` marks values produced by existing normalization, so
  authored-only consumers can ignore them.

The underlying TypeScript type for an authored value may still be `ValueSlot`,
but that is a core AST representation detail. The event vocabulary is
"authored value" and "resolved value."

Private implementation map for a future eval-observer slice:

| Call site | Event | Semantics |
|---|---|---|
| CSS-value resolution entry | `authoredValue`, moment `enter`, resolution `css-value` | observes authored value before CSS bytes/value resolution |
| CSS-value resolution completion | `resolvedValue`, moment `leave`, resolution `css-value` | observes the existing resolved CSS value; if the result is thenable, fires in the continuation |
| Semantic-value resolution entry | `authoredValue`, moment `enter`, resolution `semantic-value` | observes authored value before typed/semantic resolution |
| Semantic-value resolution completion | `resolvedValue`, moment `leave`, resolution `semantic-value` | observes the existing semantic result; continuation-preserving for `MaybePromise` |
| Guard evaluation entry/completion | `guard`, moment `enter`/`leave` | observes guard evaluation without pretending guards are `node.type` nodes |
| Statement evaluation/emission loops | `statement`, moment `enter`/`leave` | observes statements as the pass reaches/completes them; async children fire `leave` in their completion continuation |

Implementation call-site mapping:

| Stable event | Initial internal call sites |
|---|---|
| CSS-value resolution | `evalValueSlot` / `evalValue` |
| Semantic-value resolution | `evalTypedSlot` / `evalTyped` |
| Guard evaluation | `evalGuard` integration points, if/when needed by a semantic consumer |
| Statement evaluation/emission | statement loops currently implemented in `emitNestedBody` and `emitAtRuleBody` |

Rules:

- Hooks are synchronous. They may throw, and throws follow the existing error
  path. They must not return promises.
- Hook dispatch has a zero-registered fast path.
- Hook dispatch must not materialize value-domain objects just to notify a hook.
  It can only pass values the existing eval path already produced.
- Synthetic nodes created by existing normalization, such as slash promotion,
  are marked `origin: 'synthetic'`. Consumers that want authored-only facts must
  ignore them.
- Internal helper evaluations may intentionally remain unobserved until a
  concrete consumer needs them. The implementation must document each skipped
  site next to the private call-site map.
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

## 11. Less Visitor Compatibility Pressure

Less visitor compatibility is not separate from this design's requirements. The
Less ABI adapter is separate from the core traversal API, but the core traversal
must be designed so the adapter can implement Less visitors lazily and correctly.

A real Less bridge needs:

- Less-shaped lazy facades;
- `accept(visitor)` on facades, not on canonical AST nodes;
- `visitArray`;
- `visit${Type}` and `visit${Type}Out`;
- `isReplacing`;
- conversion from Less replacement values back into Jess values;
- pre-eval visitor support if that compatibility surface is accepted.

The intended relationship:

- Core authored traversal owns canonical child edges and source-order traversal.
- The Less bridge builds Less-shaped facades on demand from a canonical node plus
  edge metadata.
- The Less bridge precomputes an interest table from registered visitors:
  Less-node-kind -> enter/out handlers and replacement mode. A node whose Less
  kind has no registered handler is not adapted and no no-op visitor method is
  called for it.
- The bridge may still traverse through an uninterested node's canonical child
  edges to reach interested descendants. That is traversal, not visitor
  invocation.
- Facade `accept(visitor)` uses the core edge table to discover child fields
  lazily; it does not ask the canonical node to grow an `accept()` method.
- Facade `visitArray` exposes a lazy array-like view for child collections. It
  converts child entries only when the Less visitor reads or visits them.
- The bridge must not drive raw Less `Visitor.visitArray` over a lazy child
  array, because Less's implementation loops every item and calls `visit(...)`
  for each one. The bridge-owned equivalent must consult the interest table per
  child, traverse canonical child edges to reach interested descendants, and
  adapt only node kinds that are actually registered or arrays an interested
  visitor explicitly touches.
- Read-only visitors allocate only the facades they touch and reuse identity with
  `WeakMap` caches.
- Replacing visitors allocate Less-shaped facades only for node kinds they are
  registered to inspect/replace and for child arrays they actually touch.
- Replacing visitors write to a bridge-owned patch/overlay keyed by canonical
  node plus edge, then the appropriate eval/emit phase consumes that overlay.
  They do not mutate canonical AST nodes in place.
- Pre-eval Less visitors run before semantic resolution through an explicit
  bridge pass over lazy facades. Eval/emit Less visitors attach to the phase
  hooks above. Postprocessor-like plugins are not visitor traversal and need a
  separate output-text route.

This is the design pressure on core traversal: every traversable child edge
needs a stable name and enough shape metadata for the Less bridge to lazily
present it as the Less child field a plugin expects, while every visitor
invocation must be gated by the registered Less node-kind interest table.

This pressure also applies back to AST v2. The bridge should not normalize away
fundamental AST problems. If an observed simple visitor shape cannot be mapped
without awkward reconstruction, add an AST design finding and decide whether the
canonical AST needs a shape change, a clearer edge, or a carried parser fact.

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
| dispatch interest | exact node kinds that should cause invocation; whether descendants still need traversal |
| replacement behavior | returns same node, new Less node, `undefined`, array/flattened output |
| node surface read/written | selector fields, declaration value/name, rules arrays, visibility flags, imports |
| AST pressure | whether the current AST maps directly, needs a bridge-only workaround, or reveals an AST/edge design problem |
| phase | pre-eval, eval/render, postprocessor-like, unknown |
| Jess decision | support now, support later, reject, or emulate through a narrower native hook |

The canonical traversal vocabulary is the bridge's child-discovery substrate,
but it is not itself the Less visitor ABI and should not expose Less control
semantics directly.

Current active coverage still treats Less visitors as unsupported/todo/skipped,
so implementing the canonical traversal must not claim to close that gap.

## 12. Implementation Slices

### Pre-Slice 1: AST Shape And Less Lazy-Visitation Proof

This gate happens before authored traversal implementation lands.

- Seed the visitor-shape tracking table with the mandatory owner/reviewer proof
  cases. The broader published-package corpus belongs in Slice 4, not in the
  lint/traversal critical path.
- Prove lazy visitor invocation mechanically: registering only `visitDimension`
  reaches dimensions through rules/declarations without constructing rule or
  declaration facades and without calling no-op visitor methods for those kinds.
- Prove a bridge-owned `visitArray` equivalent can traverse through uninterested
  array children to interested descendants without adapting every child.
- Prove the simple Less visitor shapes that put pressure on AST v2:
  `visitDeclaration` with `visitArgs.visitDeeper = false`, `visitDimension`
  inside declaration values, `visitRuleset` / `visitRulesetOut` over selectors
  and body, `visitSelector` plus `visitElement`, `visitCall` or
  `visitOperation` through child arrays, and `visitAtRule` with prelude/body.
- For each proof case, classify the mapping as direct AST edge, tolerable lazy
  facade, or AST/edge design problem.
- Decide or explicitly fence the known AST-pressure items before Slice 1:
  source-order body-form extends and structured `MixinCall` path/name facts.
- Verify collection traversal targets the value-keyed `CollectionEntry` design
  of record instead of the older declaration-backed transitional shape.
- Record parser construction pressure for each decided shape: whether the grammar
  can build the node locally, whether it would need a broad lookahead/reparse,
  and whether an AST change would make the parser simpler.

### Slice 1: Authored Traversal, Internal

- Add the generic authored traversal module.
- Depend on the pre-Slice-1 AST/Less proof gate above.
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

### Slice 4: Broader Less Visitor Bridge Design

- Expand the published-package visitor-shape tracking table.
- Map observed visitor shapes to lazy facade needs, replacement overlay needs,
  and phase needs.
- Record AST pressure for each observed simple shape: direct mapping, tolerable
  bridge shim, or AST/edge design problem.
- Prove the canonical edge table can drive `accept()` and `visitArray` lazily for
  those shapes.
- Prove visitor invocation is interest-table gated: no facade/no callback for
  node kinds with no registered visitor method.
- Decide which observed shapes are supported now, supported later, rejected, or
  emulated through narrower native hooks.

### Slice 5: Emit Hook Cleanup

- Rename the current output hook away from implementation-specific vocabulary if
  it remains part of the supported surface.
- Preserve the zero-registered fast path and no-second-walk rule.

## 13. Tests And Gates

Before implementation:

- adversarial review recorded below;
- review blockers resolved in this document.
- pre-Slice-1 AST shape and Less lazy-visitation proof completed.
- parser construction pressure recorded for each shape that changes AST or edge
  ownership.

For Slice 1:

- tests prove the pre-Slice-1 lazy Less proof cases remain valid or are
  explicitly fenced out of Slice 1;
- traversal tests prove source order, `skip-children`, cursor lifetime notes,
  root `ValueSlot[]` behavior, and exhaustive edge classification;
- tests prove memo/cache/raw fields are not traversed;
- guard tests prove `guard.g` traversal, not fake `node.type` traversal;
- traversal tests cover `declaration.name` interpolation, `ruleset.extend.target` /
  `ruleset.extend.subject`, `CollectionEntry` key/value traversal, and the shared
  `CallValue` rule for nested `MixinCall` values;
- tests prove traversal does not require every leaf to carry a source span;
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
- Ignoring Less visitor compatibility while designing traversal: rejected; Less
  lazy facade support is a design pressure even though the Less ABI adapter does
  not become the core traversal API.
- Driving Less's raw `Visitor.visitArray` across lazy canonical children:
  rejected because it adapts/calls every item before the interest table can keep
  uninterested node kinds cold.
- Parser reductions that stringify structured facts for later visitor recovery:
  rejected as a normal design endpoint. Carry the parser-local fact on AST when
  the grammar already has it and the consumer need is real.

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

Owner follow-up accepted after review:

- "Less visitor compatibility stays separate" was too weak. Section 11 now says
  the Less ABI adapter is separate from the core traversal API, but Less visitor
  support is a first-class design pressure. The edge table must support lazy
  facades, `accept()`, `visitArray`, and replacement overlays.
- "Lazy" for Less visitors means interest-table gated invocation, not no-op
  calls. Section 11 now requires no facade/no callback for node kinds with no
  registered visitor method.
- Less visitor support is valid design pressure on AST v2 itself. Sections 3,
  5, and 11 now say simple visitor shapes should map cleanly; if not, the AST or
  edge model is suspect before the bridge grows workarounds.

Second adversarial review completed by subagents
`019faac9-1112-72d2-b18b-ec64e9991ada`,
`019faacb-cfb4-76e3-bad6-77c6bf3b70a2`,
`019faacb-f1d1-76b2-a998-0d0759fc6b94`, and
`019faacc-17a3-73d0-a3e6-9c2bea209ed8`. Verdict: direction approved,
implementation still blocked.

Findings accepted into this revision:

- Less proof cannot wait for a late bridge slice. Section 12 now requires a
  pre-Slice-1 proof for lazy Less visitor dispatch before authored traversal
  implementation lands.
- Less's own `visitArray` is not lazy enough. Section 11 now requires a
  bridge-owned equivalent that consults the interest table before adaptation or
  callback.
- The edge matrix missed real authored structure. Section 6 now includes
  `Declaration.name` interpolation, `Ruleset.extend` selector edges,
  `CollectionEntry` key/value edges, `VariableReference` / `PropertyReference`,
  and shared
  `CallValue` traversal for nested `MixinCall` values.
- The collection finding from review was corrected by owner feedback and
  `docs/design/COLLECTION-VALUE-KEYS.md`: collections are value-keyed maps with
  `CollectionEntry { key, value }`; traversal targets that design and does not
  encode declaration-backed collections as canonical.
- Parser pressure is a first-class design test. Section 6 now records which
  desired nodes are grammar-natural and which current AST shapes force coercion,
  hoisting, or raw-string facts.
- Less selector/element, extend, and mixin path facades must be proven lazy from
  canonical edges before compatibility support is claimed.
