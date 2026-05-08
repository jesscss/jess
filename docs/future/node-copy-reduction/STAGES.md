# Node Copy Reduction — Stage Tracking

> Historical note:
> this file describes the older EvalState/NodeState stage plan from March 2026.
> It is kept only as background. The active plan is the cursor/edge direction in
> [HANDOFF.md](./HANDOFF.md) and
> [node-update-status.md](./node-update-status.md).
>
> Do not use the sections below as the current task list.

## Architecture

`EvalState extends Map<Node, NodeState>` — sparse overlay on canonical AST.

Two patch types:
1. **Node patch**: `state.get(node).replacement = newNode`
2. **Field patch**: `state.get(node).fields.set('key', value)`

Recursive subtrees for mixin/import reuse: `state.get(callNode).subtree`.

See [eval-state-sketch.md](./eval-state-sketch.md) for full design.

## Current State (2026-03-27)

### Completed

- **EvalState + NodeState** created in `eval-state.ts`
- **EvalSession / SessionInstanceRoot / EvalPosition** deleted
- **Context** wired with `evalState` / `evalStateStack` / `activeState`
- **field-helpers.ts** rewritten — single `activeState` lookup, no fallback chain
- **node-base.ts** migrated — `_isEvaluated`/`_setEvaluated`/`_isPreEvaluated`/`_setPreEvaluated` use `activeState`
- **All 21 production node files** migrated (zero new type errors)
- **Canonical `evaluated`/`preEvaluated`** removed from Node class
- **eval-session.ts** reduced to re-export shim
- **Stale docs** deleted (session-instance-architecture, dependency-graph, migration, subsystems, mixin-direct-invocation)

### Legacy Artifacts (to remove)

- `_instanceRoot` / `_evalPosition` on Node — used by mixin-instance-primitives
- `positionMap` in serialize-helper — bridges `_evalPosition` into evalStateStack
- `materializeEvaluatedCopy` / `cloneDetached*` / `clonedEval` methods
- `eval-session.ts` shim — delete when test imports updated
- Test files still reference old API (~500+ references)

### Next Steps

1. **Update test files** — replace `EvalSession`/`createSession` with `EvalState`/`activeState`
2. **Kill `_evalPosition` / `_instanceRoot`** — replace with subtree pushes in mixin-instance-primitives
3. **Kill `positionMap`** in serialize-helper — serialization uses evalStateStack directly
4. **Kill materialization methods** — `materializeEvaluatedCopy`, `cloneDetached*`, `clonedEval`
5. **Prove repeated mixin/import** — write subtree-based proofs
