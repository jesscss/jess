# Node Copy Reduction

## Target

The target model is:

- one canonical AST
- canonical nodes own canonical edges
- canonical nodes may also own alternate edges keyed by render root
- `RenderRoot` is only the path-selection key
- traversal is done through a cursor: `{ node, root }`

See [eval-state-sketch.md](./eval-state-sketch.md) for the actual shape.

## Current Runtime

The runtime still uses `EvalState` / `NodeState`.

Treat that as transitional implementation baggage, not the target architecture.

## Read Order

1. [eval-state-sketch.md](./eval-state-sketch.md) — target cursor/edge model
2. [node-update-status.md](./node-update-status.md) — current migration targets
3. [HANDOFF.md](./HANDOFF.md) — short working rules for the next agent
4. [STAGES.md](./STAGES.md) — optional branch sequencing notes
5. [CLEANUP.md](./CLEANUP.md) — cleanup list for old scaffolding

## Hard Rules

- no field-patch architecture
- no render-root-owned patch tables
- no routine deep cloning for eval isolation
- no internal materialization except at explicit downstream boundaries
- no hidden ambient state deciding which parent path a shared node uses

## Practical Rule

If one canonical node can be reached from multiple live placements, then:

- a naked `Node` is not enough for traversal
- code must carry a cursor
- parent-aware traversal must use `{ node, root }`

## Success Criteria

- repeated mixin/import reuse works without clone pressure
- returned output has clear ownership during serialization
- parent/child traversal is explainable in terms of canonical edges + alternate edges + cursor
- old EvalState-only assumptions stop spreading into new code
