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

## What Remains for Full Merge

### Mixin eval path: replace cloning with shadowing

The mixin eval path (`getFunctionFromMixins`) currently isolates each call by CLONING the mixin body, then evaluating the clone. This is fundamentally different from the import path (which uses session overlays on a shared canonical tree).

Instance roots cannot simply be added alongside cloning — the clone is already a fresh object, so shadowing it adds nothing. And state written to an instance root during eval becomes inaccessible after the instance root is deactivated, breaking downstream assertions.

The correct approach is to REPLACE cloning with instance root shadowing:

1. Keep the canonical mixin body as-is (no clone)
2. Create an instance root per call
3. Evaluate the canonical body with the instance root active
4. Shadow entries carry the per-call state (parent chains, eval state, binding deltas)
5. Output materialization happens at the call boundary

This is a larger refactor because the current loop structure (clone → set parents → eval → extract output) needs to become (create instance root → bind params → eval against canonical → materialize output). The guard evaluation, parameter wrapper, and output shaping all need to work against instance-root-backed state rather than cloned state.

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

## Test Baseline (2026-03-25, post dev merge)

- Core: 5 files failed, 82 passed, 3 skipped; 6 tests failed, 1307 passed, 24 skipped
