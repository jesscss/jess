# Task Loop

Jess task automation is intentionally plain.

The source of truth is the checked-in JSON snapshots under `tasks/`. Each task
has a `status`, `priority`, dependencies, source references, a definition of
done, and proof expectations.

## Daily Commands

```bash
pnpm task:rebuild
pnpm task:status
pnpm task:next
pnpm task:loop
pnpm task:loop -- --hours 4
pnpm task:loop -- --minutes 30
```

`task:rebuild` refreshes generated task snapshots from known inputs such as the
latest Less failure log when it exists.

`task:next` picks the highest-priority open task whose dependencies are
completed and whose `blocked_by` list is empty.

`task:loop` repeats:

1. Rebuild task snapshots.
2. Pick the next ready task.
3. Generate a focused prompt from the task, `AGENTS.md`, recent loop results,
   and `state/agent-loop/context.md`.
4. Run one Codex worker on that task.
5. Continue only if the worker moved the task to `completed` or `needs_human`.
6. Stop when no ready tasks remain.

The loop is single-worker and in-place. It does not create worktrees, worker
branches, or merge queues. The active worker edits the current checkout and
commits its own completed slice before marking the task `completed`.

When `--hours` or `--minutes` is provided, the loop checks the wall-clock budget
before starting each new task. It does not interrupt an active worker. Once the
current worker finishes, the loop powers down gracefully instead of starting
another task after the budget has expired.

## Carry-Forward Memory

The loop uses local files under `state/agent-loop/`:

- `context.md` is the short curated memory every worker receives.
- `recent-results.jsonl` records completed and needs-human outcomes.
- `current-prompt.md` is the prompt for the current worker.

These files keep workers from rebuilding context from scratch without making
old conversation history authoritative.

## Worker Contract

A worker finishes a task with:

```bash
node scripts/task-loop.mjs finish <task-id> --commit "$(git rev-parse HEAD)" --note "verification summary"
```

If the task needs human input, the worker marks it explicitly:

```bash
node scripts/task-loop.mjs needs-human <task-id> --reason "specific blocker"
```

Completed, needs-human, rejected, and superseded tasks are not selected by the
loop. There is no lease database, coordinator approval layer, or hidden runtime
state in the normal workflow.
