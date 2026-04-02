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

- `packages/core/src/tree/__tests__/import-style.test.ts` is green again
  aside from intentional skips. Import evaluation now runs through
  placement-owned top-level wrappers before eval, and compose `set` baselines
  are reused without canonically reparenting imported trees.
- Recursive live ampersand resolution in extend matching now stops at the
  current selector path boundary instead of recursing back into itself.
  Treat that as a selector-match ownership fix, not a reason to add more
  clone/materialize helpers.
- The current live Less integration blocker is
  `tests-unit/import/import-reference.less`. The source-side reference-import
  proofs are green, but the real parser-generated fixture still fails to
  activate the extended selector path cleanly. The remaining bug is the
  reference-import activation / ruleset-as-mixin ancestry seam, not the older
  exact-extend `&&` or nested `@media` storyline.
- `Reference` resolution now has one explicit guardrail in generic eval:
  when a `Reference` resolves to a definition-like node (`Mixin`, `Ruleset`,
  `Rules`, `Func`, `JsFunction`), generic eval inheritance must not overwrite
  that resolved node's identity/source ancestry. That fixed the duplicated
  `.bg()` candidate path in `media.less` without adding a new clone/materialize
  helper, and the same guardrail still applies to the reference-import path.

## What To Delete Over Time

- `_carriedState`
- `subtreeMap`
- old detached wrapper/materialize helpers
- any new code that assumes `EvalState` is the final architecture
