# Node Copy Reduction — Handoff

## Purpose

This file is the short starter doc for the next agent.

Its job is to help an agent drive this branch from the current bridge state to near-merge completion without getting lost in old scaffolding.

Keep this file short. Put detail elsewhere.

## Read Order

1. [session-instance-architecture.md](./session-instance-architecture.md)
2. [dependency-graph.md](./dependency-graph.md)
3. [PROGRESS.md](./PROGRESS.md)
4. [node-session-status.md](./node-session-status.md)

Use those docs as the source of truth. Do not rebuild their content here.

## Branch Goal

Drive the branch to the point where:

- the session-instance model is real enough to satisfy the repeated-import and repeated-mixin/function proofs
- every node row in [node-session-status.md](./node-session-status.md) is no longer blocking that model
- the rest of `packages/core` still behaves compatibly against that model
- progress docs and status docs are current
- every clean boundary is committed and pushed

Important:

- do not merge back to `dev` yet
- stop at a pushed, documented, merge-candidate state

## Target Architecture

Work toward exactly this:

- one immutable canonical/source tree
- many lazy session-local instances over that tree
- sparse dependency-guided shadow state
- unchanged, elegant node API

Do not regress into:

- one-overlay-per-canonical-node as the destination
- broad wrapper/helper growth
- internal materialization as a normal eval strategy

## Hard Rules

- no explicit instance parameters in ordinary node APIs
- no new helper family unless it clearly maps to the instance model
- no internal materialization except at an explicit downstream boundary
- do not call a local bridge-green slice “done” if it does not move the real model forward
- do not silently change Jess behavior just to make the refactor easier
- do not merge to `dev` from this handoff

## The Work Loop

Repeat this until the branch reaches the stage gate in [PROGRESS.md](./PROGRESS.md):

1. Pick the highest-value next slice from [dependency-graph.md](./dependency-graph.md) and [node-session-status.md](./node-session-status.md).
2. Implement the smallest real step toward the session-instance model.
3. Add or update the narrowest proof tests.
4. Run the focused tests for that slice.
5. Update:
   - [node-session-status.md](./node-session-status.md)
   - [PROGRESS.md](./PROGRESS.md)
   - this file only if the operational instructions changed
6. Commit the clean boundary.
7. Push it.
8. Re-rank the next owner and repeat.

At major checkpoints, also run broader `packages/core` verification so the branch stays compatible beyond the local proof surface.

## What To Update

### Update `node-session-status.md` when:

- a node stops being a proof-case
- a node becomes bridge-stable
- a node becomes relevant again because the architecture changed under it

### Update `PROGRESS.md` when:

- the active stage changes
- the acceptance proofs get sharper
- merge-readiness meaning changes

### Update `dependency-graph.md` when:

- the next stages need to be re-chunked
- a proof case moves to a different architectural owner

### Update this file when:

- the execution loop changes
- the hard rules change
- the branch goal changes

## What Full Completion Looks Like

The branch is near merge-ready when all of these are true:

- the repeated-import proof is real
- the repeated-mixin/function proof is real
- instance roots and lazy node views exist as the active runtime model
- sparse dependency-guided shadow state is real enough to carry those proofs
- bridge helpers are no longer the architectural center of the branch
- the statuses in [node-session-status.md](./node-session-status.md) reflect that reality
- the broader `packages/core` behavior is still compatible:
  - parser-driven paths still evaluate correctly
  - function/mixin/import behavior still matches intended semantics
  - integration tests are green or at the accepted baseline
- docs are current
- every meaningful boundary is committed and pushed

## Compatibility Gate

The agent should treat compatibility as part of completion, not as optional cleanup after.

That means:

- keep public Jess behavior the same unless there is an intentional, documented change
- if tests need updates because APIs changed internally, keep the same behavioral expectations whenever possible
- do not “fix” the suite by weakening expected Jess semantics
- use local proof tests for development speed, but use broader `packages/core` tests to confirm parser, lookup, function, mixin, import, and selector behavior still compose correctly

If the architecture is cleaner but the broader core behavior regressed, the branch is not done.

Again:

- do not actually merge to `dev` from this handoff
- stop when the branch is pushed and documented as merge-candidate quality

## Good Example Surfaces

Use these as concrete proof surfaces when you need examples:

- [import-style.test.ts](/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/__tests__/import-style.test.ts)
- [mixin.test.ts](/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/__tests__/mixin.test.ts)
- [call.test.ts](/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/__tests__/call.test.ts)
- [rules.test.ts](/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/__tests__/rules.test.ts)

Use those tests to prove repeated reuse, sparse divergence, and ownership shifts.

## Working Tree Notes

- ignore unrelated dirty files under `packages/docs-content/...` unless explicitly asked to work there
- challenge any change that only makes the bridge more elaborate without moving toward instance roots/views
