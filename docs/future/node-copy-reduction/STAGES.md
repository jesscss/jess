# Node Copy Reduction — Stage Tracking

## The Model

Two operations:
1. **Replace a node** at a position in the tree (field patch on the parent)
2. **Replace a field** on a node (field patch on the node)

Both are map lookups from `EvalPosition`. No cloning. No special cases.

## Current State (2026-03-26)

`EvalPosition` is implemented with `patchField`/`getField`/`hasField`. Read/write paths (`getField`/`patchField` in session-helpers) check position first. Position created per mixin call in `evaluateCandidateOutput`. `maybeClone` skips cloning when position active.

**Materialization removed**: `finalizeMixinInvocationOutput` now returns the input unchanged — no `cloneDetachedMaterializedWrapper`. Output carries `_evalPosition` from its per-call position.

**getFunctionFromMixins decomposed**: `returnFunc` is a thin ~50-line shell. All logic extracted to primitives: `evaluateMixinArgs`, `matchMixinCandidates`, `filterAndSortMixinEvalCandidates`, `evaluateCandidateOutput`, `dispatchMixinEvalCandidates`.

**All clone/materialize sites annotated**: Every `@removal-target` JSDoc in eval-path files marks what replaces each clone.

**Test results**: 23 failures / 1324 passed / 24 skipped. 13 pre-existing + 10 from removing materialization.

### Root Cause: forEachNode Canonical Mutation

`Node._forEachNodeSync` and the async `forEachNode` variant directly mutate canonical nodes when replacing children during eval (lines 1190, 1198 of node-base.ts). When a child evaluates to a new node, `(this as any)[key!] = result` writes directly to the canonical node.

This is the root blocker for per-call isolation. When the same mixin body is evaluated twice with different params, both calls write to the SAME canonical nodes. The second call overwrites the first call's results.

### The Fix (must be done together)

1. **Position-aware writes during eval**: `forEachNode` routes child replacement through `position.patchField` when position is active
2. **Position-aware reads during serialization**: `toTrimmedString` resolves fields through the carried position

These MUST be paired. Position writes without position reads = invisible patches. Position reads without position writes = stale canonical state.

The real CSS output path in `renderTree` already passes `context` via `printOptions`. So the serialization path CAN resolve through positions — it just needs each `_getValueNode(context)` / `_getName(context)` / etc. to check the position first, which the session helpers already do.

### Attempted and Reverted

- `forEachNode` with context parameter: patched field writes to position instead of canonical. **Caused 792 failures** because serialization still reads canonical fields. Need paired serialization fix.
- `propagateToPatched()` on EvalPosition: sets `_evalPosition` on every patched node. **Violated immutability**: canonical nodes can't carry per-call state because they're shared.
- Per-node `_evalPosition` in `toTrimmedString`: broke 66 tests because stale positions from other calls contaminated reads.

## Priority Stages (what's next)

### P0: Position-aware eval + serialization (the paired fix)

**Why first**: This is THE architectural blocker. Everything else depends on per-call isolation working end-to-end.

**Approach** (all steps together):
1. Add optional `context` param to `forEachNode`. When position active, string-keyed field replacements go through `patchField`.
2. In `toTrimmedString`, read fields through `getField(this, key, options.context)` when context is available.
3. `Rules.toTrimmedString` pushes `_evalPosition` into `options.context.position` during child serialization.
4. Tests that call `evald.toString()` without context → update to `evald.toString({ context })`.

**Exit**: Mixin body evaluated twice with different params produces correct per-call output. No materialization. No canonical mutation during eval.

### P1: TypeScript-enforced private fields

Same as before — make eval-time fields private with position-aware getters/setters.

### P2: Fix remaining test failures

- Update characterization tests that test materialization internals
- Fix real correctness issues (param var scope, @media prelude, etc.)

### P3-P6: Same as before (remove clones, baseline fixes, cleanup, registry alignment)

## Completed Work

- Stages 0–20: Node shapes, session infrastructure, bridge clone reduction, fundamentals gate
- SI-1 through SI-9: Instance roots, lazy views, sparse shadow, proofs, direct dispatch, IR-aware infrastructure, API cleanup
- `EvalPosition` class with field patches
- `getField`/`patchField` check position first
- Position created per mixin call
- `maybeClone` skips when position active
- Mixin body clone removed (39/46 tests pass)
- All nodes session-complete (except Rules partial)
- 25 helper functions renamed (dropped `session` prefix)
- 7 canonical `.parent` reads converted to `getParent()`
- AtRule direct mutations partially converted to position patches

## Test Baseline

**Current** (position model active): 17 failures / 1300 passed / 24 skipped
**Target**: 0 failures (including the 6 "baseline" ones)
