# Node Copy Reduction — Stage Tracking

This is the living tracking document for the entire node copy reduction effort.

## The Model

Two operations:
1. **Replace a node** at a position in the tree (field patch on the parent)
2. **Replace a field** on a node (field patch on the node)

Both are map lookups from `EvalPosition`. No cloning. No special cases. See [session-instance-architecture.md](./session-instance-architecture.md).

## Guiding Star

JIT engines are most slowed by object creation. This model creates the minimum: one Map per placement, one entry per changed node. Everything else is a pointer to canonical.

## Completed Stages

### Stage 0–6: Node Shape Migration ✓

Instance fields, `childKeys`, leaf/container node model. All 31+ node types migrated.

### Stage 7–13: Session Infrastructure ✓

`EvalSession` with field patches, runtime state, children overlays. Session-aware helpers for all field access. `resetEvalState` for mixin eval sessions.

### Stage 14–19: Clone Reduction (Bridge) ✓

`clone(true)` → `clone(false)` + session at major eval sites. Shallow wrappers (`cloneDetachedShallowWrapper`, `cloneLookupSafeShallowWrapper`). Session child overlays for Rules.

### Stage 20: Fundamentals Gate ✓

Per-node session contract audit. Most nodes reached `complete` status for session-aware reads/writes. See [node-session-status.md](./node-session-status.md).

## Session-Instance Architecture (SI stages)

### SI-1: Instance Root Core ✓

`SessionInstanceRoot` class with sparse `ShadowEntry` map. `EvalSession.createInstanceRoot()`. `Context.instanceRoot`.

### SI-2/3: Lazy Views + Sparse Shadow ✓

All helpers resolve: `ctx.instanceRoot → node._instanceRoot → session → canonical`. No explicit instance parameter in the public API.

### SI-4: Dependency-Guided Reach ✓

`DependencyReach` with `computeDependencyReach()` / `isAffected()`.

### SI-5/6: Repeated Import + Mixin Proofs ✓

17 proof tests demonstrating 3 instance roots over one canonical tree with sparse shadow.

### SI-7: Direct Mixin Dispatch ✓

`evalMixinDirect()` bypasses `getFunctionFromMixins` → `callWithContext` → `returnFunc` roundtrip. Instance roots associated with all mixin output.

### SI-8: IR-Aware Eval Infrastructure ✓

- `_isEvaluated` / `_setEvaluated` / `_isPreEvaluated` / `_setPreEvaluated` — IR-aware
- `adopt()` — IR-aware
- `_setChildAt` / `_setChildren` / `push` / `splice` / `unshift` — IR-aware
- `Rules.createShallowBodyWrapper()` — O(N) array copy without adopting
- `Rules` constructor accepts `Context | TreeContext`
- `syncRegistryCache` — IR-aware (reads from IR children overlay)

### SI-9: API Cleanup ✓

Dropped `session` prefix from all helper functions (25 renames across ~40 files). Functions are now the primary access path, not alternatives.

## Active Work

### Clone Elimination in Mixin Path

**Status**: Infrastructure complete, clone replacement blocked.

**Mixin body clone replaced**: `clone(true)` → `clone(false)` ✓

46/46 mixin tests pass. 1310/1341 total (1 new regression).

**How it works**:
- `ctx.instanceRoot` set temporarily during `clone(false)`
- `clone(false)` detects instanceRoot → passes Context to Rules constructor
- Constructor adopts children through IR (not canonical)
- Canonical parent chains preserved for shared children

**1 remaining regression**: `at-rule.test.ts > media.less AST serialization` — nested `@media` with interpolated prelude. The shallow clone shares AtRule children, and the interpolated prelude eval writes onto the shared descendant. Fix requires `ctx.instanceRoot` active during nested eval, which currently causes 66 failures from non-IR-aware code paths.

**Steps completed**:
1. ✅ Audited 7 critical canonical `.parent` reads, converted to `getParent()`
2. ✅ `clone(false)` passes Context to constructor when instanceRoot active
3. ✅ Mixin body `clone(true)` → `clone(false)` + IR

**Next step**: Fix nested @media regression by making AtRule prelude eval IR-aware, or by activating `ctx.instanceRoot` during the full eval (requires making more node eval paths IR-aware).

### Registry Architecture Rewrite

**Status**: Proposal documented in [session-instance-architecture.md](./session-instance-architecture.md).

**What's needed**: Per-instance-root registry views built from canonical + diff. Lazy population. Skip `globalRegistryCache` for IR-backed Rules.

**Bitset opportunities**: Visibility bitset, registry presence bitset, instance root diff bitset.

### Remaining Clone Sites

| Location | Clone type | Status |
|----------|-----------|--------|
| `rules.ts` getFunctionFromMixins body | ~~`clone(true)`~~ `clone(false)` | ✅ Done (1 @media regression) |
| `rules.ts` evaluateCandidateOutput evalScope | `clone(true)` | Low priority — outerRules is small (just params) |
| `rules.ts` Ruleset candidate | `clone(true)` | Needs nested selector context — may need deep clone |
| `call.ts` Collection/detached rulesets | `clone(true)` | Simpler — one site |
| `import-style.ts` compose re-eval | `cloneLookupSafeShallowWrapper` | Already shallow |
| `extend.ts` selector rewriting | `copy(true)` | Structural mutation — edge case |

### Canonical `.parent` Audit ✓

7 critical eval-time `.parent` reads converted to `getParent()`: reference.ts (4x), call.ts (1x), import-style.ts (2x). Remaining `.parent` reads are in extend utilities and non-eval paths — documented in mixin-direct-invocation.md.

### Partial Session Nodes ✓

All nodes are now session-`complete`:
- Declaration, Paren, Quoted, Url — eval-time mutations now routed through helpers
- Only `Rules` remains `partial` (has remaining clone sites)

## Reference Documents

- [session-instance-architecture.md](./session-instance-architecture.md) — target architecture + registry rewrite proposal
- [subsystems.md](./subsystems.md) — target node model, field reference, adapter architecture
- [mixin-direct-invocation.md](./mixin-direct-invocation.md) — mixin clone elimination plan with experimental findings
- [node-session-status.md](./node-session-status.md) — per-node session + clone-free status
- [CLEANUP.md](./CLEANUP.md) — incremental cleanup items for agents
- [HANDOFF.md](./HANDOFF.md) — starter doc for new agents

## Test Baseline

**2026-03-25** (post dev merge + SI work): 1311 passed, 6 pre-existing failures, 24 skipped
