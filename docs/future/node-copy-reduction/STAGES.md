# Node Copy Reduction — Stage Tracking

## The Model

Two operations:
1. **Replace a node** at a position in the tree (field patch on the parent)
2. **Replace a field** on a node (field patch on the node)

Both are map lookups from `EvalPosition`. No cloning. No special cases.

## Current State

`EvalPosition` is implemented with `patchField`/`getField`/`hasField`. Read/write paths (`getField`/`patchField` in session-helpers) check position first. Position created per mixin call in `evaluateCandidateOutput`. `maybeClone` skips cloning when position active.

**Test results**: 39/46 mixin tests pass with NO mixin body clone. 17/1341 total failures (7 new from position model, 4 being characterization tests that need updating, rest need debugging).

## Priority Stages (what's next)

### P1: Make node fields TypeScript-enforced

**Why first**: Every remaining failure is caused by direct field mutation that bypasses the position. TypeScript can catch these at compile time if fields are private with position-aware getters/setters.

**Approach**: For each node type, make eval-time fields `private` with:
- Getter: reads from `position.getField(this, field) ?? this._field`
- Setter: routes through `position.patchField(this, field, value)` when position active

**Start with**: AtRule (we're already debugging it). Then Declaration, Ruleset, Mixin, Call — the nodes in the mixin eval hot path.

**Exit**: TypeScript compilation catches direct field mutations. No more hunting.

### P2: Fix remaining mixin test failures

**Why second**: With P1 done, remaining failures should be clear — either field mutations caught by TS, or logic issues in the eval flow.

**Current failures** (7 new):
- 1 `@media` prelude interpolation (`$fallback` not resolved)
- 1 param var scope (lazy nested lookup)
- 5 characterization tests (check session layer — need updating for position model)

**Approach**: Debug one test at a time. Fix the underlying issue (direct mutation → position patch). Update characterization tests to check position instead of session.

### P3: Remove remaining clones

With position model working for mixins, apply same pattern to:
- Ruleset-as-mixin candidates
- `evaluateCandidateOutput` evalScope
- Call Collection/detached rulesets
- StyleImport compose wrappers

Each is one clone site → one position creation.

### P4: Fix the 6 "baseline" failures

These are on this branch and need fixing:
- `eval-session.test.ts` — mixin param binding
- `ampersand.test.ts` × 2 — selector collapse
- `declaration.test.ts` — rules coalescing
- `extend-eval-integration.test.ts` — extend chaining AST shape
- `dependency-graph.test.ts` — variable tracking through mixin params

### P5: Clean up old infrastructure

Remove code that the position model replaces:
- `SessionInstanceRoot` class (replaced by `EvalPosition`)
- `ShadowEntry` / `DependencyReach` types
- `node._instanceRoot` field
- `resolveInstanceRoot()` helper
- IR-aware `_setChildAt` / `_setChildren` / `push` / `splice` / `unshift` overrides
- `createShallowBodyWrapper()` method
- `maybeClone()` (or reduce to just `return this`)
- Children overlay infrastructure on `EvalSession`

### P6: Registry alignment

Registries index canonical children. With position model:
- Registry reads canonical + checks position for replaced children
- Per-position registry cache if needed
- Bitset acceleration opportunities

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
