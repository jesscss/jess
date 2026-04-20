# Task System

This directory documents the durable task and execution-memory system for the Jess monorepo.

## Source Of Truth

- Stable specs/docs define architectural intent.
- `tasks/` holds canonical current task snapshots.
- The local runtime database stores leases, runs, submissions, and event-ingestion state.

## How To Read A Task

Read the assigned task file as the current canonical snapshot, not as a history log.

- `status` tells you the current coordinator-approved state.
- `last_transition_event_id` points at the event that produced the current state.
- `accepted_commit` and `accepted_run_id` identify the last accepted implementation result, if one exists.
- `depends_on` and `blocked_by` are explicit task links and should be treated as required structural data, even when empty.

## Read Order For Agents

1. `AGENTS.md`
2. Relevant stable spec/design docs
3. `docs/tasks/README.md`
4. The assigned task file under `tasks/`
5. Generated task handoff bundle from the coordinator

## Coordinator Approval

Coordinator approval is the only authority that moves a task into an accepted or completed state.

- Worker output can propose a transition, but it does not change canonical task state by itself.
- When the coordinator accepts work, it records the authoritative transition event and the accepted run or commit references.
- If a task has not been coordinator-approved, treat it as still in flight even if a worker claims success.

## Statuses And Events

Statuses are snapshots of coordinator state, not worker intent.

- `open`: task is available but not yet leased.
- `leased`: a worker has the task, but no implementation state has been accepted.
- `in_progress`: active work is underway.
- `awaiting_review`: work is ready for coordinator review.
- `completed`: coordinator accepted the task outcome.
- `needs_human`: the task requires human intervention or direction.
- `rejected`: the proposed work or transition was declined.
- `superseded`: the task was replaced by a newer authoritative task.

Events explain how the snapshot changed.

- The latest accepted transition event should be the source for the current snapshot state.
- Use the event stream to reconstruct what happened; use the task snapshot to decide what is current.
- If snapshot fields and event history disagree, trust the coordinator-controlled snapshot and investigate the mismatch.

## Write Rules

- Workers may not directly update canonical task files.
- Workers may not directly update the runtime database.
- The coordinator is the only authoritative writer for task-state transitions.

## Runtime Database

The local runtime database is a SQLite file under `state/task-runtime/`.

It is the authoritative source for:
- leases
- runs
- submissions
- event-ingestion bookkeeping

It is not committed to git.
Unversioned runtime databases with preexisting tables are rejected until an explicit migration path exists.

## Operator Commands

Operator commands should target the task system itself, not bypass it with ad hoc file edits.
