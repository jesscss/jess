# Simple Agent Task Loop

The earlier codex-auto coordinator/runtime experiment is retired.

The replacement is deliberately small:

- task snapshots live in `tasks/`
- loop memory lives in local `state/agent-loop/`
- `scripts/task-loop.mjs` rebuilds, selects, prompts, and transitions tasks
- `scripts/agent-task-loop.sh` repeats one fresh Codex worker per ready task

There is no runtime database, lease model, generated handoff bundle, worker
branch promotion layer, or coordinator-owned approval state in the normal loop.
There are also no worker worktrees or worker branches. The loop runs one worker
in the current checkout and waits for that worker before starting the next task.

## Commands

```bash
pnpm task:rebuild
pnpm task:status
pnpm task:next
pnpm task:loop
pnpm task:loop -- --hours 4
```

## Loop Shape

```text
while ready tasks remain:
  stop if the time budget expired
  rebuild task snapshots
  pick highest-priority unblocked open task
  generate a focused prompt from task + short loop context
  run one Codex worker
  require the worker to mark completed or needs_human
  repeat
```

The task file itself is the queue. Marking a task `completed`, `needs_human`,
`rejected`, or `superseded` pops it out of the ready queue.

Because workers run in-place, there is no merge step. A worker that completes a
task commits directly in the current checkout, then updates the task snapshot.

The wall-clock budget is cooperative. The loop checks it between tasks, so a
worker that already started can finish and update task state before shutdown.

## Memory Shape

`state/agent-loop/context.md` is the compact shared memory for the next worker.
It should stay short and operational: current direction, known gotchas, and
rules that save repeated rediscovery.

`state/agent-loop/recent-results.jsonl` is append-only local evidence from
recent loop transitions. It is useful context, but checked-in task snapshots
remain the durable source of truth.
