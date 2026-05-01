# Canonical Task Registry

This directory contains canonical checked-in task snapshots for active monorepo work.

Each task file is the authoritative current-state snapshot for one task.
The simple agent loop reads these files directly, chooses the next ready task,
and moves completed or blocked tasks out of the ready queue by updating the
task's `status`.

## Commands

- Rebuild generated task snapshots: `pnpm task:rebuild`
- Show queue status: `pnpm task:status`
- Show the next ready task: `pnpm task:next`
- Run the agent loop: `pnpm task:loop`

Workers finish one task by running:

```bash
node scripts/task-loop.mjs finish <task-id> --commit "$(git rev-parse HEAD)" --note "verification summary"
```

When a task needs human judgment, workers run:

```bash
node scripts/task-loop.mjs needs-human <task-id> --reason "specific blocker"
```

The loop keeps lightweight carry-forward context in `state/agent-loop/`.
That directory is local state, not canonical history.
