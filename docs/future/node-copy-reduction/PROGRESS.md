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

- 1296 tests passing (same as pre-instance-root baseline)
- 6 pre-existing failures (unchanged)
- Import eval path wired with instance roots (zero regressions)
- Parser integration requires `dev` merge (parsers updated there)

## What Remains for Full Merge

### Mixin eval path wiring

The `getFunctionFromMixins` loop in `rules.ts` is tightly coupled to session-level state. The per-candidate eval creates clones, sets parent chains, and evaluates guards — all at the session level. Wiring instance roots there requires restructuring the clone-based isolation to shadow-based isolation.

### Clone/materialization sunset

Once instance roots carry eval paths, these wrapper methods become unnecessary:

- `cloneDetachedShallowWrapper` → replaced by instance root with parent shadow
- `cloneLookupSafeShallowWrapper` → replaced by instance root with parent shadow
- `cloneDetachedMaterializedWrapper` → replaced by instance root (only at output boundary)

### Parser integration

Parsers were updated in `dev` branch. Merge `dev` → `jess-dev` before testing parser-driven eval paths.

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

## Test Baseline (2026-03-24)

- Core: 5 files failed, 82 passed, 3 skipped; 6 tests failed, 1296 passed, 24 skipped
