# Session Instance Roadmap

## Purpose

This doc chunks the next work into the distinct stages that matter now.

Read this after:

1. [README.md](./README.md)
2. [session-instance-architecture.md](./session-instance-architecture.md)

Use [node-session-status.md](./node-session-status.md) for per-node bridge status.

## Where The Branch Actually Is

The bridge work already proved:

- immutable source nodes are workable
- many canonical eval-time writes can be removed
- helper-overlay migration exposed the real hard cases

The bridge work did not solve:

- many live instances of the same canonical subtree in one session
- sparse shadowing across broad reused trees
- repeated import/mixin/function reuse on top of one source tree

So the work now needs a stage reset.

## Stage Reset

### Stage SI-0: Bridge Orientation

Status: already landed enough for context.

This includes:

- node-keyed session helpers
- local wrapper seams
- isolated clone/materialization pressure
- local node migrations

Use it as orientation only. Do not optimize it like it is the final runtime.

### Stage SI-1: Instance Root Core

Goal:

- define `SessionInstanceRoot`
- make one eval session capable of holding many roots over the same canonical subtree

Exit criteria:

- repeated placements can exist in one session without fighting over one node-keyed overlay slot
- root-local state is clearly separated from canonical-node-keyed bridge state

### Stage SI-2: Lazy Node Views

Goal:

- make runtime objects look like normal nodes
- back them with `source node + instance root`
- create them lazily

Exit criteria:

- no explicit instance parameter growth in the public node API
- ordinary node code still feels normal
- parent/sourceParent/runtime state is instance-local

### Stage SI-3: Sparse Shadow State

Goal:

- store only actual divergence
- keep untouched structure source-backed

Exit criteria:

- no broad overlay-per-tree behavior
- no deep clone pressure for ordinary reuse
- changed paths can be shown to stay thin even across broad trees

### Stage SI-4: Dependency-Guided Reach

Goal:

- use dependency reach to decide which paths need shadow state

Exit criteria:

- binding/input deltas do not cause broad shadow growth
- sparse effects can be demonstrated on repeated imports and repeated mixin calls

### Stage SI-5: Repeated Import Proof

Goal:

- prove the architecture with repeated imports

Required proof:

- same file imported 3 times as `multiple`
- imports 2 and 3 each change one value
- only thin local state is created for those changed paths

### Stage SI-6: Repeated Mixin / Function Proof

Goal:

- prove the architecture with repeated mixin/function reuse

Required proof:

- same mixin/function body reused 3 times
- one changed input affects only one downstream path
- only thin local state is created for that affected path

The current `Call` same-source composite `Rules` seam is the sharpest proof case for this stage.

### Stage SI-7: Collapse Bridge APIs

Goal:

- aggressively retire bridge-only helper surfaces once the instance model is real

Targets:

- `sessionGet*` / `sessionSet*` sprawl
- wrapper-helper sprawl
- node-keyed overlay assumptions

### Stage SI-8: Re-audit Nodes And Merge Gate

Goal:

- re-evaluate node status only after the instance model is real

Exit criteria:

- repeated import proof passes
- repeated mixin/function proof passes
- node statuses are re-audited against the real runtime model
- merge to `dev` is behavior-safe

## Immediate Next Work

The next work should be chunked like this:

1. define instance roots
2. define lazy node views
3. move sparse shadow state ownership to the root
4. tie dependency reach to sparse writes
5. prove repeated imports
6. prove repeated mixin/function reuse

## What Not To Do

- do not add public API parameters for instance identity
- do not keep expanding helper/wrapper families as if they are permanent
- do not treat a local green scaffold slice as architectural completion
- do not normalize internal materialization as a runtime strategy
