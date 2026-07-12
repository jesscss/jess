## Auto Loop

The automation loop now reads work from the canonical task registry instead of scraping handoff or proposal prose.

Source of truth:

- `tasks/` holds canonical task snapshots
- `state/task-runtime/runtime.sqlite` holds runtime execution state
- `state/codex-auto/` holds local coordinator artifacts such as logs, run directories, and manual overrides

Execution base:

- worker and integration worktrees are created from `automation_base_ref` when configured
- promotion pushes to `automation_branch`
- this lets a feature branch exercise the migrated loop against its own code before sharing the branch remotely

The coordinator is the only authority that:

- selects the next task
- starts runs
- applies authoritative task transitions
- marks outcomes as completed, needs-human, or rejected

Workers do not mutate canonical task state directly.

## Commands

Status:

```bash
bash scripts/codex-auto-status.sh
```

One iteration:

```bash
bash scripts/codex-auto-loop.sh --once
```

Continuous loop:

```bash
bash scripts/codex-auto-loop.sh
```

Manual selection:

```bash
bash scripts/codex-auto-loop.sh --once --task-id runtime-db-bootstrap
```

## Task Selection

The loop discovers tasks from `tasks/index.json` and the canonical task files it references.

Selection uses:

- task snapshot status
- runtime lease state
- task priority
- task bucket
- manual override pins and queue entries

Broad expansion work can remain deferred while concrete runtime or Less fixture tasks are selected first.

## Worker Inputs

Each worker run receives:

- a generated task markdown prompt file
- a cold-start handoff bundle
  - `task_snapshot.json`
  - `task_context.json`
  - `recent_events.json`
  - `verification_policy.json`

This keeps workers aligned with durable repo state instead of conversational context.

## Runtime State

Runtime state is split intentionally:

- `state/task-runtime/`
  - SQLite runtime DB
  - durable execution state
- `state/codex-auto/`
  - local coordinator outputs
  - discovered task cache
  - run artifacts
  - logs
  - manual overrides

These directories are local runtime state, not canonical repo truth.

## Manual Steering

Operator steering goes through:

```bash
node scripts/task-runtime/operator-tasks.mjs --help
```

Use that command surface for reprioritization, blocking, task creation, or track focus instead of ad hoc task file edits.
