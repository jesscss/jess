# Session Instance Roadmap

## Purpose

This doc chunks the work into distinct stages.

Read this after:

1. [README.md](./README.md)
2. [session-instance-architecture.md](./session-instance-architecture.md)

Use [node-session-status.md](./node-session-status.md) for per-node status.

## Stage Status

### Stage SI-0: Bridge Orientation ✓

Already landed. Includes node-keyed session helpers, local wrapper seams, isolated clone/materialization pressure, local node migrations.

### Stage SI-1: Instance Root Core ✓

- `SessionInstanceRoot` class with sparse `ShadowEntry` map
- `EvalSession.createInstanceRoot()` / `getInstanceRoots()` / `getInstanceRootsFor()`
- `Context.instanceRoot` for threading active root during eval
- 7 proof tests

### Stage SI-2: Lazy Node Views ✓

- All session helpers check `ctx.instanceRoot` first
- Resolution order: instanceRoot → session → canonical
- The "view" is the (canonical node, active instance root) pair, resolved at access time
- No explicit instance parameters in the public node API

### Stage SI-3: Sparse Shadow State ✓

- `ShadowEntry` holds `fieldPatches` and `runtime` per canonical node
- Children overlays per instance root
- Untouched nodes have zero shadow entries
- `shadowCount` tracks sparsity

### Stage SI-4: Dependency-Guided Reach ✓

- `DependencyReach` interface (changedBindings + affectedNodes)
- `computeDependencyReach()` uses session dependency annotations
- `isAffected()` for quick check (conservative when no reach computed)

### Stage SI-5: Repeated Import Proof ✓

- 3 instance roots over one canonical source tree
- Only thin local state for changed paths
- Untouched paths stay source-backed
- Dependency reach narrows affected nodes

### Stage SI-6: Repeated Mixin/Function Proof ✓

- 3 instance roots over one canonical mixin body
- One changed input affects only one downstream path
- Static declarations stay source-backed
- Independent eval state and children per call

### Stage SI-7: Import Eval Path Wiring ✓

- Instance roots created per import placement in `import-style.ts`
- Backward-compatible (zero regressions)
- Mixin eval path (`getFunctionFromMixins`) needs restructuring — documented but not landed

### Stage SI-8: Re-audit and Docs ✓

- PROGRESS.md updated with current reality
- node-session-status.md updated with wired/instance-ready/bridge-stable statuses
- Test baseline recorded: 1296 passed, 6 pre-existing failures

## Remaining Work (Post-Handoff)

### Mixin Eval Path Wiring

The `getFunctionFromMixins` loop in `rules.ts` creates clones per candidate, evaluates guards in fresh sessions, and manages parent chains at the session level. Wiring instance roots requires:

1. Restructure the per-candidate loop to create instance roots instead of clones
2. Move guard evaluation to use instance-root-scoped sessions
3. Ensure parent chain and eval state are per-instance-root, not per-session

### Clone/Materialization Sunset

Once instance roots carry mixin eval paths:

- `cloneDetachedShallowWrapper` → instance root with parent shadow
- `cloneLookupSafeShallowWrapper` → instance root with parent shadow
- `cloneDetachedMaterializedWrapper` → instance root (materialization only at output boundary)

### Parser Integration

Parsers were updated in `dev` branch. Merge `dev` → `jess-dev` before testing parser-driven paths.
