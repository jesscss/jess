# Node Copy Reduction — Handoff

## Read This First

1. [eval-state-sketch.md](./eval-state-sketch.md)
2. [node-update-status.md](./node-update-status.md)
3. [README.md](./README.md)

## Current Direction

The branch should move toward:

- canonical nodes with canonical edges
- alternate parent/child edges keyed by `RenderKey`
- field-aligned child edge storage (`fooEdge` / `fooEdges`)
- cursor-based traversal: `{ node, renderKey }`
- shallow `Rules` wrappers as the owners of local declaration/mixin/ruleset registries

The branch should move away from:

- `EvalState` / `NodeState` as the target model
- field patches
- render-root-owned patch tables
- clone/materialize escape hatches for ordinary eval flow

Core tests no longer need to preserve old-model mutation APIs. Do not add new
`activeState` / `setField` / `getField` test setup back into
`packages/core/src/tree/__tests__` or `packages/core/src/tree/util/__tests__`.

## Working Rules

- preserve Jess behavior
- prefer smaller targeted changes over broad rewrites
- do not introduce new detached overlay concepts
- if a node cannot answer a parent question without a render key, use a cursor
- if a lookup only needs path selection, pass `renderKey` or cursor, not full
  `Context`
- for typed field reads, prefer `get<Field>(renderKey?)`
- on converted nodes, inline `fooEdge?.get(renderKey) ?? foo` instead of
  routing typed field reads back through generic `.get(...)`
- reserve `enter<Field>(...)` for helpers that may wrap/adopt to establish a
  render-owned container
- if a node-local value truly changes identity, use a thin derived node only if edge rewiring is not enough
- if a canonical node's static field changes, do not mutate it in place:
  create or return a derived non-canonical replacement and let eval/edge wiring
  own that new placement
- if a node is already non-canonical (`EVAL` or any other non-canonical
  `RenderKey`), it is ephemeral: mutate or replace it directly and do not keep
  the displaced derived node alive unless some edge still points to it
- treat every clone/materialize helper as temporary debt, not neutral
  infrastructure
- treat generic function-wrapper machinery as suspect runtime overhead too;
  `defineFunction()` should eventually stop using a `Proxy` for metadata
  exposure and attach stable metadata (`name`, `options`, `_internal`)
  directly to the callable instead
- recent guard debugging narrowed one live Less seam:
  `tests-unit/mixins-guards/mixins-guards.less` is no longer blocked on the old
  lock-closure / recursive-mixin failures. The live failure is now
  `ReferenceError: 'space-list' is not defined`, and the reduced repro only
  fails when the earlier `.variouse-types-comparison` guarded-mixin calls run
  before `.list-comparison`. Treat that as runtime state leakage / reuse across
  repeated guarded mixin evaluation until proven otherwise; do not go back to
  broad parser-shape or mixin-output rewrites first.
- the end-state is to remove generic `Node.clone()` / `Node.copy()` as ordinary
  runtime tools from `node-base`; until then, every production callsite is
  suspect and must justify itself in `node-update-status.md`
- every remaining clone/materialize seam must be tracked in
  `node-update-status.md` with:
  - why it still exists
  - what exact blocker keeps it alive
  - what change should delete it
- if a deep clone still exists in a hot runtime path, prove the blocker first.
  Current known examples:
  - JS-function arg isolation is blocked on the lack of an immutable/view model
  - mixin arg normalization still has legacy frozen-copy paths around
    `@arguments` / rest aggregation
- do not add new generic `childEdges` maps as target architecture
- when iterating, prefer one narrow component proof over broad suite churn

## Work Loop

1. Pick one narrow production target from [node-update-status.md](./node-update-status.md).
2. Change the smallest owner/path surface that moves that target toward cursor + edge traversal.
3. Add or update one focused proof test for that exact surface.
4. Run only the focused proof and the nearest behavioral file while iterating.
5. Update docs only if the model or migration status actually changed.
6. Commit and push.

## Current Narrow Frontier

- `tests-unit/import/import-reference.less` is fixed. Keep the reference-owned
  activation model simple: print suppression defaults off under reference
  boundaries, and only explicit activation paths opt specific descendants back
  in.
- Two narrow guarded-mixin proofs are green again:
  - `tests-unit/mixins-closure/mixins-closure.less`
  - `tests-unit/mixins/mixins-advanced.less`
- Minimal production-shaped repros for nested lock capture and recursive mixins
  are green. The remaining live Less blocker is
  `tests-unit/mixins-guards/mixins-guards.less`.
- The current reduced repro for that fixture is:
  - shared `.generic(...)` guarded overloads
  - `.variouse-types-comparison { ... }`
  - `.list-comparison { ... }`
  with the failure only appearing when the earlier guarded calls run first.
  The hard `ReferenceError: 'space-list' is not defined` has now been removed by
  normalizing invocation source-parent selection away from reference/call
  pseudo-owners and by anchoring call-site container arg values. The remaining
  issue in that same fixture is smaller but still real: repeated guarded calls
  are leaving output/closure regressions (missing spaces in emitted `content:`
  values and a dropped `.call-lock-mixin .call-inner-lock-mixin` block).

## What To Delete Over Time

- `_carriedState`
- `subtreeMap`
- old detached wrapper/materialize helpers
- any new code that assumes `EvalState` is the final architecture
