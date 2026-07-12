import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileTaskRegistry, extractFailedLessFixtures } from './refresh-task-registry.mjs';

const ansiLog = `
\u001b[31m FAIL \u001b[0m packages/jess/test/less/all-less.test.ts
     × tests-unit/comments/comments.less 8ms
     × tests-unit/comments/comments2.less 7ms
     × tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.less 4ms
`;

assert.deepEqual(extractFailedLessFixtures(ansiLog), [
  'tests-unit/comments/comments.less',
  'tests-unit/comments/comments2.less',
  'tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.less',
]);

const existingTasks = [
  {
    task: {
      id: 'less-at-rules-comments',
      title: 'Preserve authored comments in at-rule preludes',
      track: 'less-registry-redesign',
      bucket: 'less-fixture',
      priority: 'p1',
      status: 'completed',
      source_refs: ['docs/future/performance/2026-04-13-registry-redesign-proposal.md'],
      goal_refs: ['less parity recovery'],
      depends_on: [],
      blocked_by: [],
      definition_of_done: 'done',
      proof_expectations: ['proof'],
      accepted_commit: 'abc123',
      accepted_run_id: 'run-1',
      last_transition_event_id: 'event-1',
    },
  },
];

const compiled = compileTaskRegistry({
  existingTasks,
  allLessLogText: ansiLog,
});

assert.equal(compiled.find((task) => task.id === 'less-at-rules-comments')?.status, 'completed');
assert.equal(compiled.find((task) => task.id === 'less-at-rules-comments')?.accepted_commit, 'abc123');
assert.ok(compiled.some((task) => task.id === 'less-comments'));
assert.ok(compiled.some((task) => task.id === 'less-comments-comments2'));
assert.ok(compiled.some((task) => task.id === 'less-registry-expansion'));
assert.ok(compiled.some((task) => task.id === 'handoff-retirement-followups'));

const sandboxRoot = mkdtempSync(join(tmpdir(), 'jess-task-refresh-'));
try {
  const tasksDir = join(sandboxRoot, 'tasks');
  const lessDir = join(tasksDir, 'less-registry');
  mkdirSync(lessDir, { recursive: true });

  const repoTaskIndex = {
    version: 1,
    task_directories: [
      { id: 'less-registry-redesign', title: 'Less parity', directory: 'tasks/less-registry' },
      { id: 'task-memory-foundation', title: 'Task memory', directory: 'tasks/less-registry' },
      { id: 'repo-wide-rollout', title: 'Rollout', directory: 'tasks/less-registry' },
      { id: 'operational-doc-retirement', title: 'Retirement', directory: 'tasks/less-registry' },
    ],
  };

  writeFileSync(join(tasksDir, 'index.json'), JSON.stringify(repoTaskIndex, null, 2));
  writeFileSync(
    join(lessDir, 'less-at-rules-comments.json'),
    JSON.stringify(existingTasks[0].task, null, 2),
  );

  const logPath = join(sandboxRoot, 'all-less.log');
  writeFileSync(logPath, ansiLog);

  execFileSync(
    'node',
    [
      'scripts/task-runtime/refresh-task-registry.mjs',
      '--index',
      join(tasksDir, 'index.json'),
      '--all-less-log',
      logPath,
      '--write',
    ],
    {
      cwd: new URL('../..', import.meta.url).pathname,
      encoding: 'utf8',
    },
  );

  const refreshedComments = JSON.parse(readFileSync(join(lessDir, 'less-comments.json'), 'utf8'));
  assert.equal(refreshedComments.status, 'open');

  const refreshedAlias = JSON.parse(readFileSync(join(lessDir, 'less-at-rules-comments.json'), 'utf8'));
  assert.equal(refreshedAlias.status, 'completed');
  assert.equal(refreshedAlias.accepted_commit, 'abc123');
} finally {
  rmSync(sandboxRoot, { recursive: true, force: true });
}
