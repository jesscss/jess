# Node Update Status

This file tracks the next runtime surfaces to move toward the render-root
cursor model.

It is intentionally short. It should only answer:

- what still depends on the old EvalState model?
- what should be moved next?

## Target Checklist

The target model is:

- canonical nodes own alternate parent/child edges
- traversal uses a cursor: `{ node, root }`
- no field-patch architecture
- no render-root-owned patch tables
- no clone/materialize escape hatch for ordinary eval flow

## Immediate Next Surfaces

### 1. Parent/child traversal helpers

Status: `next`

Current issue:

- parent/child traversal still assumes `Context.activeState` and field helpers

Target:

- introduce cursor-aware edge helpers
- make parent-aware traversal explicitly depend on `{ node, root }`

Likely files:

- `packages/core/src/tree/util/field-helpers.ts`
- `packages/core/src/tree/node-base.ts`
- `packages/core/src/tree/util/serialize-helper.ts`

### 2. Detached ruleset / mixin output ownership

Status: `next`

Current issue:

- detached/mixin output still relies on hidden carried state and wrapper logic

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

## Notes

- `selectorBeforeExtend` should be treated as current-runtime baggage, not part
  of the target minimal shape
- `sourceNode` is provenance, not a substitute for render-path selection
