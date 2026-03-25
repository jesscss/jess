# Node Copy Reduction — Stage Tracking

This is the living tracking document for the entire node copy reduction effort.

## Guiding Star

JIT engines are most slowed by object creation. Deep cloning creates O(N²) objects per mixin call. The target: immutable canonical trees + sparse instance-root shadowing = O(1) per placement.

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

**What works**: `createShallowBodyWrapper` produces a shallow wrapper with fresh children array (O(N) vs O(N²)). All Rules mutators route through IR when `ctx.instanceRoot` active.

**What blocks clone replacement**: When `ctx.instanceRoot` is activated during `Rules.eval()`, 27 tests fail because individual node types' `preEval`/`evalNode` methods still write eval results directly onto canonical nodes. The shallow wrapper shares children, so call #1's eval state bleeds into call #2.

**Specifically tested**:
- `createShallowBodyWrapper` alone → 4 regressions (shared descendant values leak)
- With `ctx.instanceRoot` during eval → 27 regressions (too many code paths write to canonical)
- `clone(false, undefined, ctx)` passing Context to constructor → 7 regressions (canonical `.parent` reads fail when adoption goes through IR)

**Next steps** (in order):
1. Audit all canonical `.parent` reads in eval pipeline, convert to `getParent(node, ctx)`
2. Enable `clone(false, undefined, ctx)` to pass Context to Rules constructor
3. Set `ctx.instanceRoot` during eval — should then work with IR-aware mutators + IR-aware constructor
4. Replace mixin body `clone(true)` with `clone(false)` + IR

### Registry Architecture Rewrite

**Status**: Proposal documented in [session-instance-architecture.md](./session-instance-architecture.md).

**What's needed**: Per-instance-root registry views built from canonical + diff. Lazy population. Skip `globalRegistryCache` for IR-backed Rules.

**Bitset opportunities**: Visibility bitset, registry presence bitset, instance root diff bitset.

### Remaining Clone Sites

| Location | Clone type | Status |
|----------|-----------|--------|
| `rules.ts` getFunctionFromMixins body | `clone(true)` | Blocked on eval pipeline IR-awareness |
| `rules.ts` evaluateCandidateOutput evalScope | `clone(true)` | Follows from body clone |
| `rules.ts` Ruleset candidate | `clone(true)` | Needs nested selector context — may need deep clone |
| `call.ts` Collection/detached rulesets | `clone(true)` | Simpler — one site |
| `import-style.ts` compose re-eval | `cloneLookupSafeShallowWrapper` | Already shallow |
| `extend.ts` selector rewriting | `copy(true)` | Structural mutation — edge case |

### Canonical `.parent` Audit

**Status**: Not started.

**Goal**: Find all places in the eval pipeline that read `node.parent` directly instead of `getParent(node, ctx)`. Convert them to use the helper. This is the prerequisite for IR-aware constructor adoption.

**Scope**: All files under `packages/core/src/tree/` that read `.parent` during eval.

### Partial Session Nodes

These nodes have `partial` session status — some paths still mutate canonical:

- `Declaration` — caller-side mutation paths
- `Paren` — render/read session-aware, write paths pending
- `Quoted` — render/read session-aware, write paths pending
- `Url` — render/read session-aware, write paths pending

## Reference Documents

- [session-instance-architecture.md](./session-instance-architecture.md) — target architecture + registry rewrite proposal
- [subsystems.md](./subsystems.md) — target node model, field reference, adapter architecture
- [mixin-direct-invocation.md](./mixin-direct-invocation.md) — mixin clone elimination plan with experimental findings
- [node-session-status.md](./node-session-status.md) — per-node session + clone-free status
- [CLEANUP.md](./CLEANUP.md) — incremental cleanup items for agents
- [HANDOFF.md](./HANDOFF.md) — starter doc for new agents

## Test Baseline

**2026-03-25** (post dev merge + SI work): 1311 passed, 6 pre-existing failures, 24 skipped
