import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createRuntimeState } from './runtime-state.mjs';

const dbPath = '/tmp/jess-task-runtime-test.sqlite';
rmSync(dbPath, { force: true });

const state = createRuntimeState(dbPath);

state.insertEvent({
  event_id: 'evt-1',
  task_id: 'runtime-db-bootstrap',
  event_type: 'task_created',
  ts: '2026-04-20T00:00:00Z',
  actor: 'test',
  run_id: null,
  payload: {},
});

let events = state.listEvents('runtime-db-bootstrap');
assert.equal(events.length, 1);
assert.equal(events[0].event_id, 'evt-1');

assert.equal(state.listOpenTasks([{ id: 'runtime-db-bootstrap' }]).length, 1);

state.createRun({
  run_id: 'run-failed',
  task_id: 'runtime-db-bootstrap-failed',
  branch: 'codex/test-failed',
  worktree: '/tmp/worktree-failed',
  status: 'running',
  started_at: '2026-04-20T00:00:30Z',
});

assert.equal(state.getTaskStatus('runtime-db-bootstrap-failed'), 'leased');

state.finishRun('run-failed', 'failed', '2026-04-20T00:00:45Z');

assert.equal(state.getTaskStatus('runtime-db-bootstrap-failed'), 'open');
assert.equal(state.listOpenTasks([{ id: 'runtime-db-bootstrap-failed' }]).length, 1);

state.createRun({
  run_id: 'run-1',
  task_id: 'runtime-db-bootstrap',
  branch: 'codex/test',
  worktree: '/tmp/worktree',
  status: 'running',
  started_at: '2026-04-20T00:00:00Z',
});

state.insertEvent({
  event_id: 'evt-2',
  task_id: 'runtime-db-bootstrap',
  event_type: 'task_completed',
  ts: '2026-04-20T00:01:00Z',
  actor: 'test',
  run_id: 'run-1',
  payload: {},
});

events = state.listEvents('runtime-db-bootstrap');
assert.equal(events.length, 2);
assert.equal(state.getTaskStatus('runtime-db-bootstrap'), 'completed');
assert.equal(state.listOpenTasks([{ id: 'runtime-db-bootstrap' }]).length, 0);

state.recordSubmission({
  submission_id: 'sub-1',
  run_id: 'run-1',
  task_id: 'runtime-db-bootstrap',
  classification: 'jess-bug',
  candidate_commit: 'abc1234',
  summary: { verification: ['node scripts/task-runtime/runtime-state.test.mjs'] },
  created_at: '2026-04-20T00:02:00Z',
});

const runtime = state.getTaskRuntime('runtime-db-bootstrap');
assert.equal(runtime.status, 'completed');
assert.equal(runtime.active_run_id, null);

state.close();
