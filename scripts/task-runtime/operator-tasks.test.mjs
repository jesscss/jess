import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRuntimeState } from './runtime-state.mjs';

const tempRoot = mkdtempSync(join(tmpdir(), 'jess-operator-tasks-'));

try {
  const tasksDir = join(tempRoot, 'tasks', 'runtime');
  mkdirSync(tasksDir, { recursive: true });

  const task = {
    id: 'runtime-db-bootstrap',
    title: 'Bootstrap SQLite runtime store for durable task execution',
    track: 'task-memory-foundation',
    bucket: 'runtime',
    priority: 'p0',
    status: 'open',
    source_refs: ['docs/superpowers/specs/2026-04-20-durable-task-memory-design.md'],
    goal_refs: ['local durable runtime store'],
    depends_on: [],
    blocked_by: [],
    definition_of_done:
      'SQLite runtime store exists with schema, coordinator can read/write it, and old JSONL-only state is no longer authoritative.',
    proof_expectations: [
      'schema bootstrap test',
      'runtime query smoke',
      'coordinator state read/write proof',
    ],
    accepted_commit: null,
    accepted_run_id: null,
    last_transition_event_id: null,
  };

  const indexPath = join(tempRoot, 'tasks', 'index.json');
  writeFileSync(
    indexPath,
    `${JSON.stringify(
      {
        task_directories: [{ id: 'task-memory-foundation', directory: 'tasks/runtime' }],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(join(tasksDir, 'runtime-db-bootstrap.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');

  const dbPath = join(tempRoot, 'runtime.sqlite');
  const snapshotOnlyOutput = execFileSync(
    process.execPath,
    [
      resolve('scripts/task-runtime/operator-tasks.mjs'),
      'status',
      '--json',
      '--tasks-index',
      indexPath,
      '--runtime-db',
      dbPath,
    ],
    { encoding: 'utf8' },
  );

  assert.equal(existsSync(dbPath), false);

  const snapshotOnlyTasks = JSON.parse(snapshotOnlyOutput);
  assert.equal(snapshotOnlyTasks.length, 1);
  assert.equal(snapshotOnlyTasks[0].id, task.id);
  assert.equal(snapshotOnlyTasks[0].status, 'open');

  const state = createRuntimeState(dbPath);

  state.createRun({
    run_id: 'run-1',
    task_id: task.id,
    branch: 'codex-auto-worker/runtime-db-bootstrap',
    worktree: '/tmp/runtime-db-bootstrap',
    status: 'running',
    started_at: '2026-04-20T23:55:00Z',
  });

  state.leaseTask(task.id, {
    lease_owner: 'worker-1',
    lease_expires_at: '2099-04-20T23:59:59Z',
    active_run_id: 'run-1',
    updated_at: '2026-04-20T23:55:00Z',
  });
  state.close();

  const output = execFileSync(
    process.execPath,
    [
      resolve('scripts/task-runtime/operator-tasks.mjs'),
      'status',
      '--json',
      '--tasks-index',
      indexPath,
      '--runtime-db',
      dbPath,
    ],
    { encoding: 'utf8' },
  );

  const tasks = JSON.parse(output);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, task.id);
  assert.equal(tasks[0].status, 'leased');

  const rejectedFile = join(tempRoot, 'rejected.jsonl');
  writeFileSync(
    rejectedFile,
    `${JSON.stringify({
      task_id: task.id,
      ts: '2026-04-20T23:58:00Z',
      classification: 'legacy',
    })}\n`,
    'utf8',
  );

  rmSync(dbPath, { force: true });
  const legacyState = createRuntimeState(dbPath, {
    legacyJsonl: {
      rejectedFile,
    },
  });
  assert.equal(legacyState.getTaskStatus(task.id), 'rejected');
  legacyState.close();

  const rejectedOutput = execFileSync(
    process.execPath,
    [
      resolve('scripts/task-runtime/operator-tasks.mjs'),
      'status',
      '--json',
      '--tasks-index',
      indexPath,
      '--runtime-db',
      dbPath,
    ],
    { encoding: 'utf8' },
  );

  const rejectedTasks = JSON.parse(rejectedOutput);
  assert.equal(rejectedTasks.length, 1);
  assert.equal(rejectedTasks[0].id, task.id);
  assert.equal(rejectedTasks[0].status, 'rejected');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
