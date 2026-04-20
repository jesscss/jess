# Task System

This directory documents the durable task and execution-memory system for the Jess monorepo.

## Source Of Truth

- Stable specs/docs define architectural intent.
- `tasks/` holds canonical current task snapshots.
- The local runtime database stores leases, runs, submissions, and event-ingestion state.

## Read Order For Agents

1. `AGENTS.md`
2. Relevant stable spec/design docs
3. `docs/tasks/README.md`
4. The assigned task file under `tasks/`
5. Generated task handoff bundle from the coordinator

## Write Rules

- Workers may not directly update canonical task files.
- Workers may not directly update the runtime database.
- The coordinator is the only authoritative writer for task-state transitions.

## Operator Commands

Operator commands should target the task system itself, not bypass it with ad hoc file edits.
