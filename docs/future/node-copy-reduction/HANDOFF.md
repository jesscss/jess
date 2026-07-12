# Node Copy Reduction — Handoff

## Purpose

Short starter doc for the next agent. Helps drive the branch to completion
without getting lost in old scaffolding.

## Read Order

1. [eval-state-sketch.md](./eval-state-sketch.md) — canonical architecture
2. [README.md](./README.md) — overview + hard rules
3. [STAGES.md](./STAGES.md) — current execution status
4. [node-update-status.md](./node-update-status.md) — per-node migration status
5. [CLEANUP.md](./CLEANUP.md) — tracked cleanup items

## Architecture (Summary)

`EvalState extends Map<Node, NodeState>` — one per evaluation pass.
`NodeState` has `replacement` (node patch), `evaluated`/`preEvaluated` (flags),
`fields` (lazy Map for other overrides), `subtree` (lazy recursive EvalState).

Context holds `evalState` (root), `evalStateStack` (subtree stack),
`activeState` (innermost or root).

Two operations:
1. **Replace a node**: `ctx.activeState.get(node).replacement = newNode`
2. **Override a field**: `ctx.activeState.get(node).fields.set('key', value)`

No cloning. No sessions. No instance roots. No EvalPosition.

## Hard Rules

- no explicit instance parameters in ordinary node APIs
- no internal materialization except at explicit downstream boundaries
- no cloning as an isolation mechanism
- every design decision should reduce object creation during eval
- do not silently change Jess behavior to make the refactor easier
- do not merge to `dev` from this handoff

## The Work Loop

1. Pick the next node or subsystem from [node-update-status.md](./node-update-status.md).
2. Implement using EvalState (node patches + field patches + subtrees).
3. Run focused tests for that node.
4. Update status docs.
5. Commit and push.

## What Full Completion Looks Like

- repeated-import proof: same file imported 3x, each with its own subtree EvalState
- repeated-mixin proof: same mixin called 3x, different subtrees
- all node classes use EvalState API (no legacy session/position code)
- test suite passes at baseline
- docs are current
- branch is pushed and documented as merge-candidate

## Legacy Code Still Present

These are migration artifacts to be removed:

- `_instanceRoot` / `_evalPosition` on Node — used by mixin-instance-primitives
- `positionMap` in serialize-helper — bridges `_evalPosition` into stack
- `materializeEvaluatedCopy` / `cloneDetached*` methods — dead or nearly dead
- `eval-session.ts` — thin re-export shim, delete when all test imports updated
- `session-instance-proofs.test.ts` — entire file tests deleted concepts

## Good Test Surfaces

- `import-style.test.ts` — import reuse
- `mixin.test.ts` — mixin calls
- `call.test.ts` — function/mixin call mechanics
- `rules.test.ts` — rules container eval
