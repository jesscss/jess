# Node Copy Reduction

## Architecture

One immutable canonical/source tree. One `EvalState` overlay per evaluation pass.
Sparse node patches and field patches only where behavior diverges.
Recursive subtree states for mixin/import reuse with different bindings.

See [eval-state-sketch.md](./eval-state-sketch.md) for the full design.

## Read Order

1. [eval-state-sketch.md](./eval-state-sketch.md) — canonical architecture
2. [state-node-association.md](./state-node-association.md) — subtree linkage problem and approaches
3. [STAGES.md](./STAGES.md) — current execution status
4. [HANDOFF.md](./HANDOFF.md) — starter guide for next agent
5. [node-update-status.md](./node-update-status.md) — per-node migration status
6. [CLEANUP.md](./CLEANUP.md) — tracked cleanup items

## Core Classes

```ts
class EvalState extends Map<Node, NodeState> {
  get(node): NodeState     // auto-creates
  peek(node): NodeState?   // read-only, no allocation
}

class NodeState {
  replacement: Node | undefined  // node patch
  evaluated: boolean             // eval flag
  preEvaluated: boolean          // preEval flag
  fields: Map<string, unknown>   // lazy field overrides
  subtree: EvalState             // lazy recursive state
}
```

## Context Integration

```ts
class Context {
  evalState: EvalState           // root state (lazy)
  evalStateStack: EvalState[]    // subtree stack
  activeState: EvalState         // innermost subtree or root
}
```

## Hard Rules

### Runtime rule

Internal evaluation operates on canonical source nodes + EvalState patches.
Not on materialized/cloned trees.

### Materialization rule

Materialization is only allowed at an explicit downstream boundary where
Jess must hand off a standalone object graph. If an internal eval path
still needs materialization, that path is not done.

### API rule

Do not make node usage uglier. The EvalState is internal plumbing.
`node.eval(context)` is the public API.

## What Counts As Success

### Repeated import proof

Import the same file 3 times. Each import gets its own subtree EvalState.
Only divergent nodes get entries. Untouched nodes stay canonical.

### Repeated mixin proof

Call the same mixin 3 times with different args. Each call gets its own
subtree EvalState. Only the affected path gets patches. The rest of the
canonical body is shared.
