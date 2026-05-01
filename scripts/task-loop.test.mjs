import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'jess-simple-loop-'));
const scriptPath = resolve('scripts/task-loop.mjs');
const loopScriptPath = resolve('scripts/agent-task-loop.sh');

function task(overrides) {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    track: overrides.track ?? 'loop-test',
    bucket: overrides.bucket ?? 'test',
    priority: overrides.priority ?? 'p2',
    status: overrides.status ?? 'open',
    source_refs: overrides.source_refs ?? ['docs/future/node-copy-reduction/HANDOFF.md'],
    goal_refs: overrides.goal_refs ?? ['test loop'],
    depends_on: overrides.depends_on ?? [],
    blocked_by: overrides.blocked_by ?? [],
    definition_of_done: overrides.definition_of_done ?? 'Task is complete.',
    proof_expectations: overrides.proof_expectations ?? ['test proof'],
    accepted_commit: overrides.accepted_commit ?? null,
    accepted_run_id: overrides.accepted_run_id ?? null,
    last_transition_event_id: overrides.last_transition_event_id ?? null,
  };
}

function run(args, options = {}) {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: resolve('.'),
    encoding: 'utf8',
    ...options,
  });
}

try {
  const tasksDir = join(tempRoot, 'tasks', 'loop-test');
  const stateDir = join(tempRoot, 'state', 'agent-loop');
  mkdirSync(tasksDir, { recursive: true });

  const indexPath = join(tempRoot, 'tasks', 'index.json');
  writeFileSync(
    indexPath,
    `${JSON.stringify(
      {
        version: 1,
        task_directories: [{ id: 'loop-test', title: 'Loop test', directory: 'tasks/loop-test' }],
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    join(tasksDir, 'blocked.json'),
    `${JSON.stringify(task({ id: 'blocked', priority: 'p0', depends_on: ['first'] }), null, 2)}\n`,
  );
  writeFileSync(
    join(tasksDir, 'first.json'),
    `${JSON.stringify(task({ id: 'first', priority: 'p1' }), null, 2)}\n`,
  );
  writeFileSync(
    join(tasksDir, 'second.json'),
    `${JSON.stringify(task({ id: 'second', priority: 'p2' }), null, 2)}\n`,
  );
  writeFileSync(
    join(tasksDir, 'done.json'),
    `${JSON.stringify(task({ id: 'done', priority: 'p0', status: 'completed' }), null, 2)}\n`,
  );

  const status = JSON.parse(run(['status', '--json', '--tasks-index', indexPath, '--state-dir', stateDir]));
  assert.equal(status.total, 4);
  assert.equal(status.open, 3);
  assert.equal(status.completed, 1);
  assert.equal(status.ready, 2);

  const next = JSON.parse(run(['next', '--json', '--tasks-index', indexPath, '--state-dir', stateDir]));
  assert.equal(next.id, 'first');

  assert.throws(
    () => run(['finish', 'first', '--tasks-index', indexPath, '--state-dir', stateDir], { stdio: 'pipe' }),
    /finish requires --commit <sha>/,
  );

  run([
    'finish',
    'first',
    '--commit',
    'abc123',
    '--note',
    'verified first task',
    '--tasks-index',
    indexPath,
    '--state-dir',
    stateDir,
  ]);

  const first = JSON.parse(readFileSync(join(tasksDir, 'first.json'), 'utf8'));
  assert.equal(first.status, 'completed');
  assert.equal(first.accepted_commit, 'abc123');
  assert.match(first.last_transition_event_id, /^simple-loop:finish:first:/);

  const nextAfterFinish = JSON.parse(run(['next', '--json', '--tasks-index', indexPath, '--state-dir', stateDir]));
  assert.equal(nextAfterFinish.id, 'blocked');

  run([
    'needs-human',
    'blocked',
    '--reason',
    'ambiguous semantics',
    '--tasks-index',
    indexPath,
    '--state-dir',
    stateDir,
  ]);

  const blocked = JSON.parse(readFileSync(join(tasksDir, 'blocked.json'), 'utf8'));
  assert.equal(blocked.status, 'needs_human');

  const prompt = run(['prompt', 'second', '--tasks-index', indexPath, '--state-dir', stateDir]);
  assert.match(prompt, /Task id: second/);
  assert.match(prompt, /Agent Loop Context/);
  assert.match(prompt, /To finish this task/);

  const recentResults = readFileSync(join(stateDir, 'recent-results.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    recentResults.map((entry) => [entry.task_id, entry.status]),
    [
      ['first', 'completed'],
      ['blocked', 'needs_human'],
    ],
  );

  const expiredLoop = execFileSync('bash', [loopScriptPath, '--hours', '0'], {
    cwd: resolve('.'),
    encoding: 'utf8',
  });
  assert.match(expiredLoop, /Time budget reached; no new task will be started\./);

  const expiredLoopWithSeparator = execFileSync('bash', [loopScriptPath, '--', '--hours', '0'], {
    cwd: resolve('.'),
    encoding: 'utf8',
  });
  assert.match(expiredLoopWithSeparator, /Time budget reached; no new task will be started\./);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
