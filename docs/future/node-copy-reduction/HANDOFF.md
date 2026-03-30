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

## Working Rules

- preserve Jess behavior
- prefer smaller targeted changes over broad rewrites
- do not introduce new detached overlay concepts
- if a node cannot answer a parent question without a render key, use a cursor
- if a node-local value truly changes identity, use a thin derived node only if edge rewiring is not enough
- do not add new generic `childEdges` maps as target architecture

## Work Loop

1. Pick the next target from [node-update-status.md](./node-update-status.md).
2. Change the smallest surface that moves the runtime toward cursor + edge traversal.
3. Run focused tests.
4. Update docs only if the model or migration status actually changed.
5. Commit and push.

## What To Delete Over Time

- `_carriedState`
- `subtreeMap`
- old detached wrapper/materialize helpers
- any new code that assumes `EvalState` is the final architecture
