# Durable Task And Memory System Design

Date: `2026-04-20`
Status: Draft

## Goal

Design a durable, repo-wide task and execution-memory system for the Jess
monorepo that:

1. gives agents a reliable source of truth for what work is open, blocked, in
   progress, or complete
2. preserves enough structured history that newly spawned agents can recover
   context without conversational hand-holding
3. reduces hallucination by replacing inference-from-prose with explicit state,
   validation, and proof requirements
4. stays practical for a single human operator to manage

This system replaces operational “handoff” documents as the primary source of
truth for active work. Specs and design docs remain the source of architectural
intent; the task system becomes the living source of truth for execution state.

## Primary Design Constraints

### Single-Operator Maintainability

The system must be easy for one person to run and inspect.

That means:

- the operator surface must stay small
- normal agent work must not require routine human approval
- state must be inspectable without specialized infrastructure
- the system must prefer strong machine guards over extra human process

The goal is to reduce cleanup and interpretation work, not add a new layer of
administration.

### Cold-Start Agent Reliability

A newly spawned agent must be able to get up to speed quickly from the durable
system itself.

The system must make it easy for a fresh agent to answer:

- what task am I working on?
- what is the current authoritative state?
- what has already been attempted?
- what counts as done?
- what am I allowed to update?

Agents should not need prior conversational context to reconstruct active work.

### Anti-Hallucination Structure

The system must not rely on agents inferring task meaning from stale prose or
freeform summaries.

Instead it must provide:

- explicit task records
- explicit status transitions
- explicit proof requirements
- explicit ownership of state mutation

The system should prevent “the agent said it was done” from becoming truth.

## Scope

### Repo-Wide By Definition

The system is defined for the whole monorepo from the start.

However, initial population only needs to cover the active Less /
registry-redesign lane. Expansion to the rest of the monorepo is itself tracked
inside the system as explicit tasks, rather than being left as an implied future
step.

### Initial Bootstrap Lane

The first populated workstream is:

- Less parity / registry-redesign recovery

That lane is used to prove the system in real conditions before broader task
population.

## Non-Goals

- Replacing stable architectural specs with operational task records
- Requiring human review for routine autonomous slices
- Building a multi-user enterprise workflow system
- Making GitHub Projects the source of truth
- Moving runtime coordination into external hosted infrastructure in v1

## Source Of Truth Model

The system has three distinct layers.

### 1. Stable Specs And Design Docs

Specs, proposals, and design docs remain the canonical source for:

- goals
- constraints
- architecture
- semantics
- non-goals

They are not the operational source of truth for active execution state.

### 2. Canonical Checked-In Task Snapshots

Each task has its own checked-in task file in the repo.

These task files are the authoritative current-state snapshots for active work.

They answer:

- what exists
- what is open
- what is blocked
- what is in progress
- what is complete
- what evidence closed it

These files are git-friendly, human-readable, and durable across sessions.

### 3. Local Durable Runtime Store

A local SQLite database holds runtime coordination state.

This database is:

- durable
- local
- not committed to git
- authoritative for runtime coordination mechanics

It stores:

- leases
- run records
- worker submissions
- checkpoint state
- event ingestion bookkeeping
- validation / promotion outcomes

Optional filesystem logs and artifacts may still exist, but they are secondary
to the runtime store.

## Why The Old Handoff Model Goes Away

Operational handoff docs are the wrong abstraction for this system.

A handoff implies:

- temporary state
- human-authored summaries
- a single transfer moment

This project needs:

- persistent operational memory
- structured state
- explicit transitions
- machine-readable history

Useful content from old handoff docs should be split into:

- stable specs or design docs where it expresses enduring intent
- task records and event history where it expresses operational state

## Task Model

Each task is a first-class object with a stable ID and a single checked-in file.

Each task file should include, at minimum:

- `id`
- `title`
- `track`
- `bucket`
- `priority`
- `status`
- `source_refs`
- `goal_refs`
- `depends_on`
- `blocked_by`
- `definition_of_done`
- `proof_expectations`
- `accepted_commit`
- `accepted_run_id`
- `last_transition_event_id`

Tasks should be organized with a moderate built-in prioritization model.

That means each task can belong to:

- a track or workstream
- a bucket or type
- a priority lane
- an optional dependency set

This is enough structure for meaningful ranking without turning the system into
a heavyweight project-management framework.

## Event History Model

Task files hold authoritative current snapshots.
History is stored separately as an append-only event log.

The event log is authoritative history, not the current snapshot.

Examples of events:

- `task_created`
- `task_reclassified`
- `task_leased`
- `worker_started`
- `worker_submitted_candidate`
- `candidate_rejected`
- `candidate_accepted`
- `promotion_passed`
- `promotion_failed`
- `task_completed`
- `task_marked_needs_human`

Every authoritative task snapshot change must correspond to at least one event.

This yields a hybrid model:

- task file = authoritative current state
- event log = authoritative history
- coordinator enforces consistency between them

## Authoritative Current State

Authoritative current state lives in task files, not in the event log.

This is intentionally not pure event sourcing.

Why:

- humans need easy current-state inspection
- task state must be reviewable in git
- one-person maintenance matters more than architectural purity

However, the system must enforce:

- no snapshot change without a matching event
- no completion without proof references
- no hidden status changes outside coordinator-controlled transitions

## State Transitions

The coordinator is the only actor allowed to perform authoritative task-state
transitions.

Core statuses:

- `open`
- `leased`
- `in_progress`
- `awaiting_review`
- `completed`
- `needs_human`
- `rejected`
- `superseded`

Workers do not write these statuses directly.

Instead:

1. worker receives a task snapshot and runtime handoff bundle
2. worker produces a candidate result
3. coordinator validates the result
4. coordinator records an event
5. coordinator updates the canonical task snapshot when appropriate

### Required Guards

Examples:

- `open -> leased`
  - task exists
  - task is not already leased
  - dependencies are satisfied or explicitly waived
- `leased -> in_progress`
  - worker run record exists
  - task snapshot bundle has been generated
- `in_progress -> awaiting_review`
  - machine-readable worker result exists
  - candidate commit or explicit no-commit reason exists
  - required proof fields exist
- `awaiting_review -> completed`
  - coordinator reran required proofs
  - promotion checks passed
  - accepted commit exists
  - accepted run is recorded
- `awaiting_review -> needs_human`
  - blocker or ambiguity is explicit
  - evidence is present
  - automation stop reason is recorded
- `awaiting_review -> rejected`
  - malformed submission
  - invalid classification
  - failed verification
  - missing evidence

These guards should be enforced mechanically, not socially.

## Checkpoints

Each loop iteration creates explicit checkpoints.

### Task Selection Checkpoint

The coordinator records:

- why a task was chosen
- priority factors
- dependency state
- current track context

### Worker Handoff Checkpoint

The worker receives a compact generated state bundle, not raw prose alone.

That bundle includes:

- task snapshot
- dependency context if relevant
- recent accepted events for the task or track
- verification policy
- allowed classifications
- write restrictions

### Candidate Submission Checkpoint

Worker output must be machine-readable and schema-validated.

It includes:

- classification
- files changed
- verification run
- proof references
- candidate commit
- unresolved concerns

### Promotion Checkpoint

The coordinator reruns required proofs and records the exact outcome.

Completion is decided only here, not at worker submission time.

### Completion Checkpoint

The coordinator records:

- acceptance event
- updated task snapshot
- accepted proof references
- accepted commit and run linkage

## Memory Handoffs For New Agents

Cold-start onboarding is a core system property.

A newly spawned agent must be able to recover state quickly from durable system
artifacts rather than conversation history.

### Agent Onboarding Surface

The system should include a stable onboarding document, such as:

- `docs/tasks/README.md`

This document explains:

- where authoritative task state lives
- where runtime state lives
- how to read a task
- what workers can and cannot update
- what coordinator approval means
- how statuses and events are interpreted

### Per-Task Handoff Bundle

When the coordinator starts a worker, it should generate a compact handoff
bundle on demand.

This bundle should include:

- `task_snapshot`
- `task_context`
- `recent_events`
- `verification_policy`

The bundle is the immediate context a fresh agent needs.

That keeps worker onboarding deterministic and fast.

## Enforcement And Write Boundaries

The design must explicitly minimize the number of things an agent can mutate.

### Workers May

- read task snapshots
- read stable specs/docs
- read generated handoff bundles
- write candidate artifacts for their own run
- create or update code/docs relevant to the assigned task

### Workers Must Not

- update canonical task state directly
- update the runtime SQLite database directly
- mark tasks complete themselves
- rewrite coordinator-owned state history

### Coordinator Responsibilities

The coordinator is the single writer for:

- canonical task-state transitions
- runtime DB status changes
- accepted / rejected / needs-human decisions
- proof acceptance

This single-writer model is essential for traceability and cross-agent
determinism.

## Validation And Proof Requirements

The system exists to reduce hallucination without requiring constant human
supervision.

Therefore the system should prefer strong machine checks over more manual
reviews.

At minimum:

- worker output must be schema-validated
- proof references must be explicit
- targeted verification must be rerun during promotion
- completion requires accepted proof and accepted commit linkage
- malformed or weak candidate results must fail closed

Human review is reserved for genuine ambiguity, not normal throughput.

## GitHub Projects

GitHub Projects may be useful later as a mirror or reporting layer, but it is
not part of the authoritative design.

The source of truth remains:

- task files in the repo
- event history
- local runtime store

This avoids letting agent behavior drift toward “working the board” instead of
working from repo-backed truth.

## Rollout Plan

### Phase 1: Foundations

- define task schema
- define event schema
- define runtime DB schema
- define coordinator and worker write boundaries
- define onboarding documentation

### Phase 2: Bootstrap Less Lane

- create initial canonical tasks for the Less / registry-redesign lane
- import useful operational state from the old handoff into task records and
  specs
- retire the handoff as operational truth

### Phase 3: Coordinator Migration

- replace current ad hoc JSONL state logic with SQLite-backed runtime state
- replace freeform worker summaries with schema-validated machine-readable
  results
- replace regex task discovery with task-registry reads

### Phase 4: Verification Hardening

- enforce targeted proof reruns at promotion
- enforce strong completion guards
- harden rejection and `needs_human` flows

### Phase 5: Repo-Wide Expansion

- create explicit tasks for expanding task coverage into other areas of the
  monorepo
- migrate additional operational docs out of handoff-style usage as they become
  covered by the task system

Expansion itself is tracked inside the task system, not left as an implicit
follow-up.

## Success Criteria

This design is successful when:

- a fresh agent can recover current task context without conversational history
- the system can answer “what is open?” and “what is done?” deterministically
- workers cannot accidentally turn weak claims into authoritative truth
- routine autonomous work does not create large cleanup debt
- the operator can manage the system without significant extra review overhead

## Open Questions For Implementation Planning

- exact on-disk layout for task files
- exact task/event schema format
- whether a repo-friendly projection of recent accepted events should be checked
  in
- migration strategy for current JSONL-based loop state
- exact CLI surfaces for task inspection, lease inspection, and run status
