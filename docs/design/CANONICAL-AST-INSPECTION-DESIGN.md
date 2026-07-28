# Canonical AST inspection design

Status: reviewed design, updated after adversarial review. Do not implement a
broader traversal surface than the phase-1 slice described here without another
review.

## 1. Problem

`@jesscss/lint` and the language service need the same problem detectors. The
lint package should own configuration, severity policy, output formatting, and
CLI/editor presentation. It should not own unique problem detection.

The common detector layer should be able to consume authored-source syntax facts
from the canonical AST when the parse is clean, and tolerant CST facts when the
file is invalid or the canonical AST cannot provide a fact yet. Parser packages
must remain recognizers and AST builders, not lint engines.

The immediate smell is the CSS `zero-units` fast path in
`packages/diagnostics-core/src/tolerant-cst.ts`: it currently finds nested
`Dimension` leaves by recursively calling `Object.values(...)` over declaration
value objects. That is diagnostics-local structural rediscovery. The AST already
has typed value leaves; diagnostics should inspect them through a reviewed
canonical-AST traversal shape.

The design must account for all of these existing surfaces:

- AST v2 in `packages/core/src/ast/nodes.ts` is plain data: PascalCase
  `type`, no base class, no `new`, no methods on nodes.
- AST value leaves carry parser facts such as
  `Dimension { number, unit, src }`; eval/render materializes value-domain
  objects only when typed value semantics are demanded.
- The current render hook in `packages/core/src/context.ts` is an emit-time
  callback over resolved legacy output `Node`s. It is useful evidence, but a
  different phase.
- Less 4 visitors are a compatibility ABI with `visit${Type}` methods,
  `visit${Type}Out`, `visitArray`, `isReplacing`, `visitDeeper`, and
  node-owned `accept(visitor)` traversal. That is not the lint/IDE fact model.
- The removed Jess visitor ABI had `ABORT`, `REMOVE`, `SKIP`, per-type methods,
  `enter`/`exit`, and a `TreeVisitor` auto-walk over legacy `Node`s. It was
  intentionally deleted and should not be recreated for diagnostics.

## 2. Design Goals

- One detector implementation feeds both language service diagnostics and
  `@jesscss/lint`.
- Lint policy is separate from detection: a rule config can disable, demote, or
  promote surfaced diagnostics, but not re-implement the detector.
- Clean CSS gets a canonical AST fast path, because AST v2 already contains more
  structure than Stylelint/PostCSS need to infer from generic nodes.
- Invalid CSS keeps the tolerant CST fallback so the editor can still surface
  useful diagnostics while the user is typing.
- No parser package source changes in the first implementation slice.
- No parse/eval/render hot path cost when diagnostics are not being collected.
- No node methods, `accept()`, mutation signals, parent stacks, eval frames, or
  Less-shaped wrappers in the canonical inspection API.

## 3. Phase Boundaries

### Parser Packages

Parser packages own recognition, grammar reductions, and parser-local AST
construction. They may report parse errors and source ranges they already own.
They must not run CSS metadata checks, custom-property value validation, unknown
property checks, duplicate-declaration policies, zero-unit policies, or other
lint-like detectors from grammar reductions.

The first lint performance slice must not edit parser source. If a future
source-span mode is proposed for value leaves, it needs a separate design and an
explicit before/after parser benchmark. The default parser path must preserve the
pre-lint performance profile.

### Canonical AST Inspection

Canonical AST inspection is read-only, pre-eval, authored-source inspection. It
observes the AST shape and existing source/body windows. It does not:

- evaluate variables, functions, mixins, guards, imports, or control flow;
- call `serialize`, `evalValue`, `evalTyped`, or value materializers;
- construct legacy `tree/Node` instances;
- construct Less-compatible wrappers;
- mutate AST nodes;
- return replacements, removal signals, skip signals, or abort signals.

This layer is eventually for authored syntax facts: statements, declarations,
at-rules, selectors, value leaves, interpolation presence, and source ranges
where those facts can be mapped without parser changes. Phase 1 is deliberately
smaller: value-slot dimensions only.

### Compiler Semantic Facts

Facts that depend on scope, imports, variable resolution, mixin dispatch,
computed values, or metadata-driven custom-property semantics belong in a
compiler/language-service semantic fact provider. Diagnostics-core should consume
those facts when they exist. It should not duplicate compiler semantics.

This is the answer to the lint/language-service coupling question: the common
layer is not "lint calls the language service" and not "the language service
calls lint." Both consume shared detector/fact providers. The language service
adds document lifecycle, incremental state, and IDE mapping. Lint adds config,
severity, file walking, and CLI output.

### Render Hooks

The current emit hook in `packages/core/src/context.ts` receives resolved output
legacy `Node`s during render. Its contract is phase-specific: `void` means
inspect/unchanged, returning a node means replace the output node, optional exit
exists for an output visitor proof, and the zero-registered case is fast.

That hook's code name is implementation-scented and should be renamed in a
separate cleanup if it remains public-ish, but the API shape should not be reused
for diagnostics. Diagnostics need authored source locations, need to run on files
that cannot render, and must not materialize output just to find source issues.

### Less 4 Visitor Compatibility

Less visitor compatibility is a bridge problem, not the canonical inspection
problem. Less 4's `Visitor` driver dispatches `visit${node.type}` and
`visit${node.type}Out`, uses `visitArgs.visitDeeper`, honors
`implementation.isReplacing`, and rewrites arrays through `visitArray`.
Less nodes own child traversal with `accept(visitor)` methods such as
Ruleset's selector/rule replacement logic.

Current active Jess coverage does not claim this ABI is supported:

- `packages/jess/test/less/at-plugin.test.ts` has the `@plugin` visitor tests as
  `describe.todo`.
- `packages/jess/test/less/all-less.test.ts` skips
  `tests-config/visitorPlugin/visitor.less`.
- `packages/jess/test/less/all-less.test.ts` tracks a legacy visitor ABI case as
  an expected failure.
- `packages/syntax/less/jess-plugin-less-compat/README.md` says Less 4 visitors,
  postprocessors, file managers, and a full Less tree adapter are unsupported.

A future Less visitor bridge needs lazy Less-shaped facades, bidirectional
conversion for replacements, `visitArray`, `isReplacing`, enter/out callbacks,
and probably a pre-eval driver. It may use canonical AST inspection internally
for read-only authored structure, but it cannot be implemented by the lint/IDE
inspection API.

## 4. Phase-1 Shape

Use inspection vocabulary, not visitor vocabulary. The name matters because
"visitor" already means mutation/replacement compatibility in Less and output
replacement in render.

Phase 1 should not add a public `AstInspector` object or a stylesheet walker.
`@jesscss/core/ast` is already an exported subpath; putting an optional-method
inspector there would create public API gravity before the shape is proven.

```ts
type DimensionVisit = (node: Dimension) => void;

function forEachDimensionInValueSlot(value: ValueSlot, visit: DimensionVisit): void;
```

Contract:

- the helper is internal to the common diagnostics implementation for phase 1;
- no callback/event object is allocated per node;
- callback returns `void`; returns are ignored by type;
- traversal is source-order and depth-first;
- no parent/path arrays are passed;
- no eval/render context is passed;
- no skip, abort, remove, replace, or descend-control values exist;
- no `accept()` methods are added to AST nodes;
- implementation is explicit `switch (node.type)` traversal, not
  `Object.values(...)`;
- new node types require updating traversal and tests.

If a later second detector needs more than dimensions, write the broader
authored-AST inspection design then. Do not promote this helper to
`@jesscss/core/ast` merely for convenience.

### Value Edge Table

The phase-1 helper must make an explicit decision for every current
`ValueNode` member. This is the table tests should pin:

| Value node | Phase-1 dimension traversal |
|---|---|
| `Dimension` | visit the node |
| `Keyword`, `Color`, `Quoted`, `Any`, `Comment`, `SelectorCapture` | no children |
| `Url` | `value` |
| `SpacedValue`, `Sequence` | `parts[]` |
| `List` | `value[]` |
| `Important`, `Block` | `inner` |
| `Operation` | `left`, `right` |
| `FunctionCall` | `args[]` |
| `Interpolation` | every `part.ref` |
| `GeneralEnclosed` | `content` |
| `VarIndirect` | `nameRef` |
| `Condition` | guard value operands (`cmp.left/right`, `truth.value`, `call.args[]`) |
| `Reference` | `base` when it is a `ValueNode`; bracket keys that are `ValueNode`; call args whose values are `ValueSlot` |
| `Range` | `start`, `end`, `step` when present |
| `Collection` | `base` when present; entry declaration values only, no statement-body descent |
| `AnonymousMixin` | no descent in phase 1; executable bodies need dialect semantic review |

That last row is intentional: a zero-unit inside an anonymous mixin body is not a
CSS authored declaration in the current clean-CSS fast path, and walking it would
silently cross into unevaluated dialect semantics. A future dialect facts pass
can revisit this with its own review.

## 5. Diagnostics Integration

Diagnostics-core should expose detectors over facts, not over parser internals:

```ts
collectAuthoredCssDiagnostics({
  root,
  source,
  metadata,
  filePath
})
```

Clean CSS path:

1. parse canonical CSS AST;
2. iterate declarations already selected by the CSS diagnostics path;
3. inspect each declaration value slot for dimensions;
4. emit `SourceDiagnostic` records with source offsets;
5. language-service and lint adapters apply user-facing policy/presentation.

Invalid CSS or recovery-heavy path:

1. parse tolerant CST;
2. report parse diagnostics;
3. run tolerant CST detectors for facts unavailable from AST.

Less/SCSS/Jess path:

- keep current tolerant CST diagnostics until canonical AST fact collection is
  reviewed per dialect;
- move semantic diagnostics to shared compiler/language-service facts rather
  than duplicating eval or metadata lookup in lint.

## 6. Immediate CSS Lint Slice

The first implementation after review should do only this:

- add the narrow internal value-dimension inspection helper;
- replace diagnostics-core's `Object.values(...)` value crawl with
  `forEachDimensionInValueSlot`;
- keep the CSS AST fast path and CST fallback behavior unchanged;
- keep `@jesscss/lint` as policy/presentation only;
- run focused diagnostics, language-service, lint, type, and export checks;
- rerun the Stylelint comparison benchmark before making any speed claim.

For `zero-units`, diagnostics should observe actual typed `Dimension` leaves
where `number === 0` and `unit` is a removable length unit.

Span recovery must not be a repeated unbounded `indexOf` by `src`. Use one
locator per declaration value window:

1. Prefer `sourceSpanOf(dimension)` if the parser side table has an exact span
   inside the declaration value window.
2. Otherwise scan forward from the previous matched dimension in the same value
   window, not from the start each time.
3. The scan is token-aware for CSS presentation: skip strings and comments,
   require dimension-token boundaries, and require the candidate text to equal
   the dimension's exact `src`.
4. If no exact token range is found, do not emit a guessed AST diagnostic for
   that leaf. A missing diagnostic is preferable to underlining the wrong bytes.

That locator is presentation mapping only. It does not decide whether a
dimension is semantically a zero-unit problem; the typed AST leaf already decided
that fact.

This is not an implementation of Less visitor compatibility. It is also not a
rename of the existing render hook.

## 7. Source Spans

Phase 1 does not add source spans to value leaves. It first uses existing
parser-authored side-table spans via `sourceSpanOf`, then falls back to the
ordered token-aware locator described above.

This is acceptable for the first slice because:

- the typed leaf supplies the semantic fact;
- source text is used only to map that known fact back to a display range;
- no parser runtime changes are required;
- the fallback CST path still handles invalid text and recovery cases.

If source lookup becomes measurable cost or produces ambiguous ranges for new
rules, the next design should be an optional source-span mode owned by
Parseman/parser integration. It must be default-off or proven no-regression on
parser benchmarks. It is not part of this design.

## 8. Why Not Alternatives

### Generic Object Walker

Rejected. It encodes AST shape outside the AST model, traverses accidental
implementation fields if memo/cache fields grow, and gives diagnostics-core a
private traversal vocabulary that the language service cannot safely share.

### Broad `AstInspector`

Rejected for phase 1. A stylesheet-level inspector with optional callbacks is
not Less ABI by itself, but it looks extensible and would become public API if
exported through `@jesscss/core/ast`. Start with the narrow internal dimension
helper; design the larger surface only when a second detector needs it.

### Node Methods Or `accept()`

Rejected for AST v2 inspection. AST v2 nodes are plain data and their object
shapes are intentionally simple. Adding methods to every node would import the
legacy tree model into the canonical AST and would make a read-only diagnostics
surface look like Less's mutation-capable visitor contract.

### Reusing Render Hooks

Rejected. Render hooks run after eval on resolved output nodes and may replace
what gets serialized. Lint/IDE diagnostics need authored source facts before
render, including while a file is broken.

### Reusing Less Visitor Compatibility

Rejected. Less visitors are a user compatibility ABI with replacement,
flattening, node-specific child traversal, and optional pre-eval behavior. That
surface is too large and too mutation-oriented for diagnostics.

### Recreating The Removed Jess TreeVisitor

Rejected. The old Jess visitor ABI had control tokens, per-type methods, exit
hooks, auto-walk machinery, and legacy `Node` assumptions. It was deleted as
unreleased/internal machinery. Diagnostics should not revive it under AST v2.

## 9. Tests And Gates

Before implementation:

- adversarial review recorded below;
- review blockers resolved in this document.

For the first implementation:

- focused tests prove value traversal order and the edge table above;
- source-location tests cover duplicate values, substring traps such as
  `10px 0px`, quoted strings, comments, and repeated zero dimensions;
- diagnostics-core tests prove CSS lint findings are unchanged;
- language-service lint-rule tests prove IDE diagnostics use the same detector
  path;
- lint tests prove policy/presentation remains in `@jesscss/lint`;
- no parser package source diff against `origin/dev`;
- `pnpm run verify:package-exports` only if a package boundary is touched;
- `pnpm run verify:types`;
- `pnpm --filter @jesscss/lint bench:stylelint` only after the code is stable,
  and only then claim performance.

## 10. Adversarial Review Questions

The reviewer should try to falsify this design with these questions:

- Is this overbuilding for lint when the immediate need is just dimensions?
- Does the shape accidentally become a Less visitor ABI?
- Does it add cost to parse, eval, or render when diagnostics are not running?
- Does exporting it create public API churn before the shape is proven?
- Does source-span recovery remain honest, or does it become a hidden parser?
- Can the language service and lint truly share detectors without one depending
  on the other's lifecycle?
- Is the value traversal exhaustive enough to prevent another diagnostics-local
  object crawl from appearing later?

## 11. Current Branch Note

The current unpushed lint performance commit still contains the generic
diagnostics-core value crawl that motivated this design. Do not push that commit
as the final shape without either replacing it with the reviewed inspection API
or explicitly shelving CSS lint performance work until the inspection API lands.

## 12. Review Record

Adversarial review completed by subagent `019faab2-f787-7572-9c87-507da7b1b75e`.

Findings accepted into this revision:

- Source-span recovery needed a stronger design than declaration-window
  `src` search. The design now requires `sourceSpanOf` first, then a monotonic
  token-aware locator, and forbids guessed spans.
- `inspectStylesheet` was too broad for the immediate slice. The design now
  limits phase 1 to value-slot dimensions and defers stylesheet inspection.
- Exporting `AstInspector` through `@jesscss/core/ast` would create public API
  gravity. The phase-1 helper is internal.
- Exhaustiveness needed a concrete edge table. The design now lists the
  `ValueNode` traversal decision per node type.

The review agreed that the phase split is correct: parser recognition,
authored-AST inspection, semantic facts, render hooks, and Less visitor
compatibility should remain separate.
