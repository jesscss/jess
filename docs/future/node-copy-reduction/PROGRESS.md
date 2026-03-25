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

The branch is not merge-ready.

Why:

- the current bridge uses node-keyed session overlays
- Jess needs many live instances of the same canonical subtree inside one session
- the final lazy-instance model is not landed yet

### Active stage

The real active work is:

- [Stage SI-1](./dependency-graph.md)
- [Stage SI-2](./dependency-graph.md)
- [Stage SI-3](./dependency-graph.md)

Meaning:

- define instance roots
- define lazy node views
- define sparse shadow state

## What The Branch Already Proved

Useful bridge work already landed:

- canonical/source nodes can be treated as the immutable base
- many direct canonical eval-time writes were removed or isolated
- local node migrations exposed where the hard cases actually live
- dependency annotations and registry deltas are real and useful
- many old clone sites were only compensating for mutation

That work matters because it reduced noise and exposed the real missing model.

## What Is Still Missing

The branch still needs a runtime that can represent:

- many live instances of one canonical subtree
- in one eval session
- with sparse local state
- while keeping the node API normal

That is now the real owner behind repeated imports, repeated mixin calls, and composite function returns.

## Acceptance Proofs

### Repeated import proof

Import the same file 3 times as `multiple`.

We need to prove:

- 3 instance roots over one canonical source tree
- imports 2 and 3 each create only thin local state for one changed value/path
- untouched paths stay source-backed

### Repeated mixin/function proof

Reuse the same mixin or stylesheet function 3 times.

We need to prove:

- 3 instance roots over one canonical body
- one changed input affects only one downstream path
- only that path gets thin local state

### Broader core compatibility proof

We also need to prove that the new runtime model still composes with the rest of `packages/core`.

That includes:

- parser-driven evaluation paths
- function, mixin, and import behavior
- selector and lookup behavior
- broader integration surfaces beyond the narrow proof-case tests

## Hard Rules

### API rule

Do not expand the public node API with explicit instance parameters.

### Materialization rule

Internal evaluation must not depend on fresh materialized trees as its normal mechanism.

Allowed:

- an explicit downstream boundary where Jess emits a standalone evaluated object graph that may outlive the session

Not allowed:

- internal forks created just to make eval work

### Bridge rule

Bridge helpers and wrapper seams are temporary.

Do not add more unless the docs also name the future instance-model primitive they collapse into.

### Compatibility rule

Behavioral compatibility is part of completion.

- update tests when internal APIs change
- keep the same Jess behavior unless a change is intentional and documented
- do not weaken broad test expectations just to make the refactor easier

## Stage Summary

The meaningful next stages are:

- `SI-1`: instance root core
- `SI-2`: lazy node views
- `SI-3`: sparse shadow state
- `SI-4`: dependency-guided reach
- `SI-5`: repeated import proof
- `SI-6`: repeated mixin/function proof
- `SI-7`: collapse bridge APIs
- `SI-8`: re-audit nodes and merge gate

See [dependency-graph.md](./dependency-graph.md) for the stage details.

## Merge-Candidate Meaning

This branch is only near merge-ready when both are true:

- the session-instance model is real enough to satisfy the new proof targets
- the broader `packages/core` suite is green or back to the accepted baseline with the same semantics

## Short Version

The bridge proved:

- immutable source nodes are right
- one-overlay-per-canonical-node is not enough

The next work should stop orbiting scaffold seams and move directly into the session-instance model.
