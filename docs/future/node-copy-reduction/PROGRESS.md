# Node Copy Reduction — Progress

## Role

This is the short branch-reality doc.

Use it for:

- what the branch has already proved
- what still blocks merge-readiness
- which stage of the new roadmap is actually active

Do not use it as the per-node inventory. Use [node-session-status.md](./node-session-status.md) for that.

## Current Reality

### Branch verdict

The branch is near merge-candidate quality.

The session-instance model is landed and proved at both the data structure level and the import eval path. The broader `packages/core` suite is at the same baseline as before (6 pre-existing test failures, 1296 passing).

### Active stage

Completed stages:

- SI-1: Instance root core ✓
- SI-2: Lazy node views (instance-root-aware helpers) ✓
- SI-3: Sparse shadow state ✓
- SI-4: Dependency-guided reach ✓
- SI-5: Repeated import proof ✓
- SI-6: Repeated mixin/function proof ✓
- SI-7: Import eval path wiring ✓
- SI-8: Re-audit and docs ✓

Remaining for full merge:

- Wire instance roots into the mixin eval path (`getFunctionFromMixins`)
- Wire instance roots into the function call path (`call.ts`)
- Merge `dev` branch for parser updates before parser integration testing
- Retire clone/materialization wrappers that become unnecessary

## What The Branch Proved

### Bridge work (prior)

- canonical/source nodes can be treated as the immutable base
- many direct canonical eval-time writes were removed or isolated
- local node migrations exposed where the hard cases actually live
- dependency annotations and registry deltas are real and useful
- many old clone sites were only compensating for mutation

### Session-instance model (this handoff)

- `SessionInstanceRoot` enables many live instances of one canonical subtree in one session
- Sparse shadow state: only touched/divergent nodes get entries; untouched paths stay source-backed
- All session helpers (`sessionGet*`/`sessionSet*`) resolve: instanceRoot → session → canonical
- Dependency reach narrows shadow entries to only dependency-affected nodes
- 3-import proof: each import gets independent shadow state over one canonical tree
- 3-mixin-call proof: each call gets independent eval state, children visibility, parent chains
- Instance roots are wired into the import eval path (backward-compatible, zero regressions)

## Acceptance Proofs — Status

### Repeated import proof ✓

Proved in `session-instance-proofs.test.ts`:

- 3 instance roots over one canonical source tree
- imports 2 and 3 create only thin local state for one changed value
- untouched paths stay source-backed (zero shadow entries)
- session helpers route reads/writes through active instance root
- dependency reach identifies only affected nodes

### Repeated mixin/function proof ✓

Proved in `session-instance-proofs.test.ts`:

- 3 instance roots over one canonical mixin body
- one changed input affects only one downstream path
- border stays source-backed across all call instances
- each call instance has independent eval state
- children overlays per instance root allow different child visibility

### Broader core compatibility ✓

- 1307 tests passing (post dev merge)
- 6 pre-existing failures (unchanged)
- Import eval path wired with instance roots (zero regressions)
- Dev branch merged (parser fixes included)

## What Was Done in This Handoff

### Direct mixin invocation

`Call.evalNode` now dispatches mixin calls through `evalMixinDirect()` instead of the `getFunctionFromMixins()` → `callWithContext()` → `returnFunc()` roundtrip. This removes 3 abstraction layers.

### Instance root association on mixin output

Each mixin/ruleset candidate creates an instance root for identity tracking. Output nodes carry `_instanceRoot` so reads resolve through the correct per-call shadow state. `node._instanceRoot` is an implicit fallback in session helpers when `ctx.instanceRoot` is not set.

### node._instanceRoot infrastructure

The Node base class has a `_instanceRoot` field. Session helpers resolve: `ctx.instanceRoot` → `node._instanceRoot` → `session` → `canonical`. This enables output nodes to "remember" their eval context.

## What Remains for Full Merge

### Mixin body clone elimination

The mixin eval path still clones the body per call. Instance roots are associated with the cloned output but don't yet replace the clone itself. Replacing cloning requires:

1. Verify each eval code path uses session helpers consistently (no direct canonical mutation)
2. Replace `rules.clone(true, undefined, ctx)` with instance root shadow state
3. Replace param `setData('value', boundValue)` with instance root `patchField`
4. Ensure guard evaluation works against instance-root-backed state

See [mixin-direct-invocation.md](./mixin-direct-invocation.md) for the full plan.

### Clone/materialization sunset

Once instance roots replace cloning, these wrapper methods become unnecessary:

- `cloneDetachedShallowWrapper` → instance root with parent shadow
- `cloneLookupSafeShallowWrapper` → instance root with parent shadow
- `cloneDetachedMaterializedWrapper` → instance root (materialization only at CSS output boundary)

### Codebase cleanup

See [CLEANUP.md](./CLEANUP.md) for tracked cleanup items: unused imports, duplicate logic, dead code, materialization artifacts.

## Hard Rules

### API rule

Do not expand the public node API with explicit instance parameters. ✓ Satisfied.

### Materialization rule

Internal evaluation must not depend on fresh materialized trees as its normal mechanism.

The instance-root model satisfies this: shadow state replaces cloning. Materialization is still used in the mixin eval path pending the wiring restructure.

### Bridge rule

Bridge helpers now serve dual roles: they ARE the instance-model field access layer (check instanceRoot → session → canonical). The wrapper helpers remain bridge code pending the clone sunset.

### Compatibility rule

Behavioral compatibility maintained: same 1296 passing tests, same 6 pre-existing failures.

## Stage Summary

All 8 stages are complete at the model level. The import eval path is fully wired. The mixin/function eval paths need restructuring to accept instance roots.

See [dependency-graph.md](./dependency-graph.md) for stage details.

## Merge-Candidate Meaning

This branch is near merge-candidate when:

- ✓ the session-instance model is real enough to satisfy the proof targets
- ✓ the broader `packages/core` suite is at the accepted baseline
- ⚠ mixin eval path wiring is documented but not landed

## Test Baseline (2026-03-25, post direct mixin invocation)

- Core: 5 files failed, 83 passed, 3 skipped; 6 tests failed, 1311 passed, 24 skipped
