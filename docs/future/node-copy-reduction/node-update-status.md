# Node Update Status

This file tracks the next runtime surfaces to move toward the render-key
cursor model.

It is intentionally short. It should only answer:

- what still depends on the old EvalState model?
- what should be moved next?

## Target Checklist

The target model is:

- canonical nodes own alternate parent/child edges
- traversal uses a cursor: `{ node, renderKey }`
- one node has one local value
- direct child fields stay direct readonly fields
- canonical child fields remain the real canonical value
- alternate edges should be field-aligned:
  - singular child: `fooEdge?: NodeEdge<T>`
  - list child: `fooEdges?: Array<NodeEdge<T> | undefined>`
- local declaration/mixin/ruleset registries should live on shallow `Rules`
  wrappers, not on canonical `Rules` and not in EvalState registry tables
- shallow `Rules` wrappers may share the same `value` / `valueEdges` until they
  actually need structural divergence
- generic `childEdges` scaffolding is temporary, not the target shape
- edge helpers use `getEdge` / `getEdgeAt` / `addEdge` / `addEdgeAt`
- "no explicit key" means "use the current cursor key", not "force canonical"
- an explicit `CANONICAL` key is what forces canonical traversal
- shallow `Rules` wrappers may store the `renderKey` they represent
- function/custom-call boundaries should receive current-view nodes, not raw
  cursor obligations
- no field-patch architecture
- no `.get()` / `.set()` as the target node API
- no render-root-owned patch tables
- no `/** @internal */` markers on ordinary child fields
- no clone/materialize escape hatch for ordinary eval flow

## Immediate Next Surfaces

### 0. Expression

Status: `started`

What changed:

- added cursor helper primitives for parent/child traversal
- `Expression` keeps a direct readonly `value` field
- singular child divergence is currently characterized with
  `addEdge(...)` / `getEdge(...)`
- focused test covers canonical fallback plus render-root-selected child edge

Relevant files:

- `packages/core/src/tree/util/cursor.ts`
- `packages/core/src/tree/expression.ts`
- `packages/core/src/tree/__tests__/expression.test.ts`

### 0a. Low-complexity child nodes

Status: `started`

What changed:

- several singular-child nodes now keep direct child fields without the
  `@internal` marker
- focused tests characterize render-key alternate child selection through the
  temporary cursor helper surface
- collection-shaped nodes now follow the same write rule:
  direct field on the canonical/current-view node, narrow inline active-state
  write only where the live instance still needs overlay semantics

Relevant files:

- `packages/core/src/tree/block.ts`
- `packages/core/src/tree/negative.ts`
- `packages/core/src/tree/paren.ts`
- `packages/core/src/tree/quoted.ts`
- `packages/core/src/tree/selector-capture.ts`
- `packages/core/src/tree/selector-interpolated.ts`
- `packages/core/src/tree/url.ts`
- `packages/core/src/tree/list.ts`

### 1. Parent/child traversal helpers

Status: `next`

Current issue:

- parent/child traversal still assumes `Context.activeState`, `getField`, and
  generic cursor scaffolding

Target:

- introduce cursor-aware helpers over field-aligned edge storage
- make parent-aware traversal explicitly depend on `{ node, renderKey }`

Likely files:

- `packages/core/src/tree/util/field-helpers.ts`
- `packages/core/src/tree/node-base.ts`
- `packages/core/src/tree/util/serialize-helper.ts`

### 2. Detached ruleset / mixin output ownership

Status: `next`

Current issue:

- detached/mixin output still relies on hidden carried state and wrapper logic
- local registry ownership still leaks through canonical/state-backed `Rules`
  paths instead of living on shallow `Rules` wrappers

Target:

- returned output should be explainable as canonical nodes plus edge-selected
  placement
- serialization should not need rescue-state discovery

Likely files:

- `packages/core/src/tree/util/mixin-instance-primitives.ts`
- `packages/core/src/tree/rules.ts`
- `packages/core/src/tree/call.ts`

### 3. Serialization cursor

Status: `needed`

Current issue:

- serialization still reasons in terms of nodes plus hidden runtime state

Target:

- serializer carries and restores a cursor while walking
- upward traversal is cursor-based, not naked-node based

Likely files:

- `packages/core/src/tree/util/serialize-helper.ts`
- `packages/core/src/tree/ruleset.ts`
- `packages/core/src/tree/rules.ts`

### 4. Context contract cleanup

Status: `later`

Current issue:

- `Context.activeState` still acts as the main internal traversal selector

Target:

- context may temporarily carry current cursor during traversal
- but cursor is the real source of truth, not detached global state

Likely files:

- `packages/core/src/context.ts`
- `packages/core/src/tree/util/field-helpers.ts`

## Transitional Baggage To Remove Over Time

- `_carriedState`
- `subtreeMap`
- detached wrapper/materialize helpers
- new code that spreads EvalState assumptions further
- generic helper surfaces that preserve `getField` / `setField` semantics under a
  new filename
- generic `childEdges` maps as a long-term architecture

## Notes

- `selectorBeforeExtend` should be treated as current-runtime baggage, not part
  of the target minimal shape
- `sourceNode` is provenance, not a substitute for render-path selection
- while migrating, if a node still needs overlay semantics, inline the narrow
  `activeState` write at the call site instead of creating a new generic field
  helper
- userland/custom-function APIs should stay node-centric; cursor semantics are
  an engine-internal traversal concern
- custom/function-call boundaries should receive current-view nodes of the same
  class, not raw edge collections
