# Node Copy Reduction

## Target

The target model is:

- one canonical AST
- canonical nodes own canonical edges
- canonical nodes may also own alternate edges keyed by render key
- canonical child fields stay the real canonical value
- alternate child edges are field-aligned (`fooEdge` / `fooEdges`)
- `RenderKey` is only the path-selection key
- canonical static-field mutation must produce a derived non-canonical
  replacement instead of mutating the canonical node in place
- non-canonical nodes are ephemeral placements: they may be mutated or replaced
  directly without preserving the previous derived node
- traversal is done through a cursor: `{ node, renderKey }`
- shallow `Rules` wrappers own local declaration/mixin/ruleset registries and
  may share canonical child arrays until they structurally diverge
- copy-on-write happens only at true mutation boundaries
- edges are a targeted tool, not a universal runtime substrate

See [eval-state-sketch.md](./eval-state-sketch.md) for the actual shape.

## Current Runtime

The runtime still uses `EvalState` / `NodeState`.

Treat that as transitional implementation baggage, not the target architecture.

Core tests have already been stripped of direct `activeState` / `EvalState` /
`setField` / `getField` usage. New work should stay on production conversion
surfaces and narrow proof tests.

## Read Order

1. [eval-state-sketch.md](./eval-state-sketch.md) — target cursor/edge model
2. [node-update-status.md](./node-update-status.md) — current migration targets
3. [HANDOFF.md](./HANDOFF.md) — short working rules for the next agent
4. [STAGES.md](./STAGES.md) — optional branch sequencing notes

## Hard Rules

- no field-patch architecture
- no render-root-owned patch tables
- no generic `childEdges` map as the target shape
- no routine deep cloning for eval isolation
- no internal materialization except at explicit downstream boundaries
- no hidden ambient state deciding which parent path a shared node uses
- no passing full `Context` to edge/path lookups when `renderKey` or cursor is
  enough
- no preserving legacy generic runtime helpers just because they already exist
- no new generic `.get(...)` on hot canonical paths
- no new clone/materialize/edge bookkeeping on a path that can be handled by
  direct canonical fields or a thin derived node
- no paying global runtime cost for rare cases such as repeated imports;
  handle those lazily at the actual divergence boundary

## Non-Negotiable Interpretation

These constraints are not preferences.

When old code conflicts with this model:

- the old code is presumed wrong for future work
- legacy runtime generality is debt, not precedent
- a passing test does not justify keeping the wrong architecture
- a green slice that preserves generic runtime tax is not success

Good direction:

- direct canonical field read on an already-resolved node
- thin derived node when identity truly changes
- sparse edge/state only where placement actually diverges

Bad direction:

- generic `.get(...)` on canonical hot paths
- clone/copy “for safety”
- keeping edge propagation “just in case”
- wrapper or helper growth to preserve legacy flexibility

## Practical Rule

If one canonical node can be reached from multiple live placements, then:

- a naked `Node` is not enough for traversal
- code must carry a cursor
- parent-aware traversal must use `{ node, renderKey }`

If a read only needs path selection, then:

- pass `renderKey`, not full `Context`
- use full `Context` only when the read truly also depends on eval-state
  machinery

## Success Criteria

- repeated mixin/import reuse works without clone pressure
- returned output has clear ownership during serialization
- parent/child traversal is explainable in terms of canonical edges + alternate edges + cursor
- old EvalState-only assumptions stop spreading into new code
