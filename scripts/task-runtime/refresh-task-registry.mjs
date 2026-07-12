import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTaskSnapshot,
  getDefaultTaskIndexPath,
  listTaskSnapshots,
  writeTaskSnapshot,
} from './lib/task-files.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '../..');
const DEFAULT_ALL_LESS_LOG = resolve(REPO_ROOT, 'state/codex-auto/results/all-less.latest.log');

const DOC_TASK_DEFINITIONS = [
  {
    id: 'less-registry-expansion',
    title: 'Expand durable task coverage beyond bootstrap Less lane',
    track: 'repo-wide-rollout',
    bucket: 'expansion',
    priority: 'p2',
    status: 'open',
    source_refs: [
      'docs/superpowers/specs/2026-04-20-durable-task-memory-design.md',
      'docs/future/performance/2026-04-13-registry-redesign-handoff.md',
    ],
    goal_refs: ['repo-wide task coverage'],
    depends_on: ['runtime-db-bootstrap'],
    blocked_by: [],
    definition_of_done:
      'At least one non-Less area is migrated into canonical task files, and migration follow-up tasks are recorded.',
    proof_expectations: [
      'canonical task files created',
      'event history linked',
      'status command shows area',
      'handoff retirement follow-up tasks linked',
    ],
    accepted_commit: null,
    accepted_run_id: null,
    last_transition_event_id: null,
  },
  {
    id: 'handoff-retirement-followups',
    title: 'Record rollout follow-ups after retiring handoff-driven execution state',
    track: 'operational-doc-retirement',
    bucket: 'rollout',
    priority: 'p1',
    status: 'open',
    source_refs: [
      'docs/future/performance/2026-04-13-registry-redesign-handoff.md',
      'docs/superpowers/specs/2026-04-20-durable-task-memory-design.md',
    ],
    goal_refs: [
      'retire handoff as operational truth',
      'track repo-wide rollout follow-ups explicitly',
    ],
    depends_on: ['less-registry-expansion'],
    blocked_by: [],
    definition_of_done:
      'Remaining rollout work that used to live only in handoff prose is represented by canonical task IDs or intentionally retired.',
    proof_expectations: [
      'handoff retirement note present',
      'follow-up task ids recorded in canonical registry',
      'status command reflects the follow-up task',
    ],
    accepted_commit: null,
    accepted_run_id: null,
    last_transition_event_id: null,
  },
];

const FIXTURE_TASK_ALIASES = new Map([
  ['tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.less', 'less-at-rules-comments'],
]);

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fixtureTaskId(fixturePath) {
  const aliased = FIXTURE_TASK_ALIASES.get(fixturePath);
  if (aliased) {
    return aliased;
  }

  const parts = fixturePath.replace(/^tests-unit\//, '').replace(/\.less$/, '').split('/');
  const basename = parts.at(-1);
  if (parts.length > 1 && parts.at(-2) === basename) {
    parts.pop();
  }
  return `less-${parts.map(slugify).join('-')}`;
}

function titleFromFixturePath(fixturePath) {
  const readable = fixturePath
    .replace(/^tests-unit\//, '')
    .replace(/\.less$/, '')
    .split('/')
    .map((part) => part.replace(/[-_]+/g, ' '))
    .join(' / ');
  return `Fix Less parity for ${readable}`;
}

export function extractFailedLessFixtures(logText) {
  const failures = [];
  const seen = new Set();
  const clean = stripAnsi(logText);
  const pattern = /^\s*[×x]\s+(tests-unit\/[^\s]+?\.less)\b/gm;

  for (const match of clean.matchAll(pattern)) {
    const fixture = match[1];
    if (!seen.has(fixture)) {
      seen.add(fixture);
      failures.push(fixture);
    }
  }

  return failures;
}

function mergeWithExisting(existingTask, nextTask) {
  if (!existingTask) {
    return nextTask;
  }

  return {
    ...nextTask,
    status: existingTask.status,
    accepted_commit: existingTask.accepted_commit,
    accepted_run_id: existingTask.accepted_run_id,
    last_transition_event_id: existingTask.last_transition_event_id,
  };
}

function buildFixtureTask(fixturePath) {
  return {
    id: fixtureTaskId(fixturePath),
    title: titleFromFixturePath(fixturePath),
    track: 'less-registry-redesign',
    bucket: 'less-fixture',
    priority: 'p1',
    status: 'open',
    source_refs: [
      'docs/future/performance/2026-04-13-registry-redesign-proposal.md',
      'packages/jess/test/less/all-less.test.ts',
      fixturePath,
      'state/codex-auto/results/all-less.latest.log',
    ],
    goal_refs: ['less parity recovery'],
    depends_on: [],
    blocked_by: [],
    definition_of_done:
      'Focused proof and targeted outer proof both pass, and accepted evidence is linked.',
    proof_expectations: [
      'targeted core or parser repro when applicable',
      'targeted less fixture proof',
      'promotion verification',
    ],
    accepted_commit: null,
    accepted_run_id: null,
    last_transition_event_id: null,
  };
}

export function compileTaskRegistry({ existingTasks, allLessLogText = '' }) {
  const compiled = new Map(existingTasks.map((entry) => [entry.task.id, { ...entry.task }]));

  for (const task of DOC_TASK_DEFINITIONS) {
    compiled.set(task.id, mergeWithExisting(compiled.get(task.id), task));
  }

  for (const fixture of extractFailedLessFixtures(allLessLogText)) {
    const nextTask = buildFixtureTask(fixture);
    compiled.set(nextTask.id, mergeWithExisting(compiled.get(nextTask.id), nextTask));
  }

  return [...compiled.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function parseArgs(argv) {
  const options = {
    indexPath: getDefaultTaskIndexPath(),
    allLessLog: DEFAULT_ALL_LESS_LOG,
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--index':
        options.indexPath = resolve(argv[++index]);
        break;
      case '--all-less-log':
        options.allLessLog = resolve(argv[++index]);
        break;
      case '--write':
        options.write = true;
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node scripts/task-runtime/refresh-task-registry.mjs [options]

Options:
  --index <path>         Task index file (default: tasks/index.json)
  --all-less-log <path>  all-less log to parse for current failures
  --write                Write refreshed canonical task snapshots
`);
        process.exit(0);
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const existingTasks = listTaskSnapshots({ indexPath: options.indexPath });
  const allLessLogText = existsSync(options.allLessLog) ? readFileSync(options.allLessLog, 'utf8') : '';
  const compiledTasks = compileTaskRegistry({ existingTasks, allLessLogText });

  if (options.write) {
    const existingById = new Map(existingTasks.map((entry) => [entry.task.id, entry]));
    for (const task of compiledTasks) {
      const existing = existingById.get(task.id);
      if (existing) {
        writeTaskSnapshot(existing.taskPath, task);
      } else {
        createTaskSnapshot(task, { indexPath: options.indexPath });
      }
    }
  }

  process.stdout.write(`${JSON.stringify(compiledTasks, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
