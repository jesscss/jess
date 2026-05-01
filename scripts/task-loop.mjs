#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '..');
const DEFAULT_TASK_INDEX_PATH = resolve(REPO_ROOT, 'tasks/index.json');
const DEFAULT_STATE_DIR = resolve(REPO_ROOT, 'state/agent-loop');
const DEFAULT_ALL_LESS_LOG = resolve(REPO_ROOT, 'state/codex-auto/results/all-less.latest.log');
const READY_STATUSES = new Set(['open']);
const PRIORITY_RANK = new Map([
  ['p0', 0],
  ['p1', 1],
  ['p2', 2],
  ['p3', 3],
]);

function usage() {
  console.log(`Usage:
  node scripts/task-loop.mjs rebuild [--all-less-log <path>]
  node scripts/task-loop.mjs status [--json]
  node scripts/task-loop.mjs get <task-id> [--json]
  node scripts/task-loop.mjs next [--json]
  node scripts/task-loop.mjs prompt <task-id>
  node scripts/task-loop.mjs finish <task-id> [--commit <sha>] [--note <text>]
  node scripts/task-loop.mjs needs-human <task-id> --reason <text>

Global options:
  --tasks-index <path>  Task index file (default: tasks/index.json)
  --state-dir <path>    Loop state directory (default: state/agent-loop)
`);
}

function parseArgs(argv) {
  const options = {
    tasksIndex: DEFAULT_TASK_INDEX_PATH,
    stateDir: DEFAULT_STATE_DIR,
    allLessLog: DEFAULT_ALL_LESS_LOG,
    json: false,
  };
  const args = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--tasks-index':
        options.tasksIndex = resolve(argv[++index]);
        break;
      case '--state-dir':
        options.stateDir = resolve(argv[++index]);
        break;
      case '--all-less-log':
        options.allLessLog = resolve(argv[++index]);
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        args.push(arg);
        break;
    }
  }

  return { command: args[0], rest: args.slice(1), options };
}

function readTaskEntries(options) {
  return listTaskFiles(options.tasksIndex).map((taskPath) => ({
    taskPath,
    task: readJson(taskPath),
  }));
}

function taskById(options) {
  return new Map(readTaskEntries(options).map((entry) => [entry.task.id, entry]));
}

function findTaskEntry(taskId, options) {
  const entry = taskById(options).get(taskId);
  if (!entry) {
    throw new Error(`Unknown task: ${taskId}`);
  }
  return entry;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertValidTask(task) {
  const required = [
    'id',
    'title',
    'track',
    'bucket',
    'priority',
    'status',
    'source_refs',
    'goal_refs',
    'depends_on',
    'blocked_by',
    'definition_of_done',
    'proof_expectations',
    'accepted_commit',
    'accepted_run_id',
    'last_transition_event_id',
  ];

  for (const key of required) {
    if (!(key in task)) {
      throw new Error(`Task ${task.id ?? '(unknown)'} is missing required key: ${key}`);
    }
  }
}

function writeTask(taskPath, task) {
  assertValidTask(task);
  writeFileSync(taskPath, stableJson(task), 'utf8');
}

function updateTask(taskId, updater, options) {
  const entry = findTaskEntry(taskId, options);
  const nextTask = updater(structuredClone(entry.task));
  writeTask(entry.taskPath, nextTask);
  return {
    taskPath: entry.taskPath,
    previousTask: entry.task,
    nextTask,
  };
}

function listTaskFiles(indexPath) {
  const index = readJson(indexPath);
  const repoRoot = dirname(dirname(indexPath));
  const files = [];

  for (const directory of [...new Set(index.task_directories.map((entry) => entry.directory))]) {
    const absoluteDirectory = resolve(repoRoot, directory);
    if (!existsSync(absoluteDirectory)) {
      continue;
    }

    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(join(absoluteDirectory, entry.name));
      }
    }
  }

  return files.sort();
}

function ensureState(options) {
  mkdirSync(options.stateDir, { recursive: true });
  const contextPath = resolve(options.stateDir, 'context.md');
  const resultsPath = resolve(options.stateDir, 'recent-results.jsonl');

  if (!existsSync(contextPath)) {
    writeFileSync(
      contextPath,
      `# Agent Loop Context

## Current Direction
- Work one task at a time from the checked-in JSON task snapshots.
- Preserve Jess behavior unless the task explicitly requires a behavior change.
- Prefer focused tests first, then the narrowest broader verification that proves the task.

## Known Gotchas
- Build dependent packages before verification when package outputs matter.
- Do not weaken baselines or expected semantics just to mark a task complete.
- If semantics are unclear, mark the task needs_human with the exact blocker.
`,
      'utf8',
    );
  }

  if (!existsSync(resultsPath)) {
    writeFileSync(resultsPath, '', 'utf8');
  }

  return { contextPath, resultsPath };
}

function isDependencyComplete(taskId, tasks) {
  const entry = tasks.get(taskId);
  return entry?.task.status === 'completed';
}

function isReady(task, tasks) {
  return (
    READY_STATUSES.has(task.status) &&
    task.blocked_by.length === 0 &&
    task.depends_on.every((taskId) => isDependencyComplete(taskId, tasks))
  );
}

function readyTasks(options) {
  const tasks = taskById(options);
  return [...tasks.values()]
    .filter((entry) => isReady(entry.task, tasks))
    .sort((a, b) => {
      const priority = PRIORITY_RANK.get(a.task.priority) - PRIORITY_RANK.get(b.task.priority);
      return priority || a.task.id.localeCompare(b.task.id);
    });
}

function status(options) {
  const entries = readTaskEntries(options);
  const counts = {
    total: entries.length,
    ready: readyTasks(options).length,
  };

  for (const entry of entries) {
    counts[entry.task.status] = (counts[entry.task.status] ?? 0) + 1;
  }

  return counts;
}

function eventId(action, taskId) {
  return `simple-loop:${action}:${taskId}:${Date.now()}`;
}

function appendResult(options, entry) {
  const { resultsPath } = ensureState(options);
  appendFileSync(resultsPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

function printTask(task, asJson) {
  if (asJson) {
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  console.log(`${task.id}\t${task.priority}\t${task.status}\t${task.track}\t${task.title}`);
}

function taskSummary(task) {
  return {
    id: task.id,
    title: task.title,
    track: task.track,
    bucket: task.bucket,
    priority: task.priority,
    status: task.status,
    definition_of_done: task.definition_of_done,
    proof_expectations: task.proof_expectations,
    source_refs: task.source_refs,
    goal_refs: task.goal_refs,
  };
}

const DOC_TASK_DEFINITIONS = [
  {
    id: 'less-registry-expansion',
    title: 'Expand task coverage beyond bootstrap Less lane',
    track: 'repo-wide-rollout',
    bucket: 'expansion',
    priority: 'p2',
    status: 'open',
    source_refs: [
      'docs/future/performance/2026-04-13-registry-redesign-handoff.md',
      'docs/future/node-copy-reduction/HANDOFF.md',
    ],
    goal_refs: ['repo-wide task coverage'],
    depends_on: [],
    blocked_by: [],
    definition_of_done:
      'At least one non-Less area is represented by a concrete checked-in task snapshot.',
    proof_expectations: ['canonical task files created', 'task-loop status shows the area'],
    accepted_commit: null,
    accepted_run_id: null,
    last_transition_event_id: null,
  },
  {
    id: 'handoff-retirement-followups',
    title: 'Represent handoff follow-ups as explicit tasks',
    track: 'operational-doc-retirement',
    bucket: 'rollout',
    priority: 'p2',
    status: 'open',
    source_refs: ['docs/future/performance/2026-04-13-registry-redesign-handoff.md'],
    goal_refs: ['stop inferring active work from prose'],
    depends_on: [],
    blocked_by: [],
    definition_of_done:
      'Remaining active handoff work is represented by task IDs or explicitly retired.',
    proof_expectations: ['task ids recorded', 'stale handoff-only action items retired'],
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

function extractFailedLessFixtures(logText) {
  const failures = [];
  const seen = new Set();
  const pattern = /^\s*[xX×]\s+(tests-unit\/[^\s]+?\.less)\b/gm;

  for (const match of stripAnsi(logText).matchAll(pattern)) {
    const fixture = match[1];
    if (!seen.has(fixture)) {
      seen.add(fixture);
      failures.push(fixture);
    }
  }

  return failures;
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
  return `Fix Less parity for ${fixturePath
    .replace(/^tests-unit\//, '')
    .replace(/\.less$/, '')
    .split('/')
    .map((part) => part.replace(/[-_]+/g, ' '))
    .join(' / ')}`;
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

function mergeTask(existingTask, nextTask) {
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

function compileTaskRegistry({ existingTasks, allLessLogText }) {
  const compiled = new Map(existingTasks.map((entry) => [entry.task.id, { ...entry.task }]));

  for (const task of DOC_TASK_DEFINITIONS) {
    compiled.set(task.id, mergeTask(compiled.get(task.id), task));
  }

  for (const fixture of extractFailedLessFixtures(allLessLogText)) {
    const task = buildFixtureTask(fixture);
    compiled.set(task.id, mergeTask(compiled.get(task.id), task));
  }

  return [...compiled.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function createTask(task, options) {
  const index = readJson(options.tasksIndex);
  const repoRoot = dirname(dirname(options.tasksIndex));
  const directory =
    index.task_directories.find((entry) => entry.id === task.track)?.directory ??
    index.task_directories[0]?.directory;

  if (!directory) {
    throw new Error(`No task directory configured for ${task.track}`);
  }

  const taskDirectory = resolve(repoRoot, directory);
  mkdirSync(taskDirectory, { recursive: true });
  writeTask(join(taskDirectory, `${task.id}.json`), task);
}

function commandValue(rest, flag) {
  const index = rest.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return rest[index + 1] ?? null;
}

function finishTask(taskId, rest, options) {
  const commit = commandValue(rest, '--commit');
  const note = commandValue(rest, '--note') ?? 'completed by simple task loop';
  if (!commit) {
    throw new Error('finish requires --commit <sha>');
  }

  const transitionId = eventId('finish', taskId);
  const result = updateTask(
    taskId,
    (task) => {
      task.status = 'completed';
      task.accepted_commit = commit;
      task.last_transition_event_id = transitionId;
      return task;
    },
    options,
  );

  appendResult(options, {
    task_id: taskId,
    status: 'completed',
    note,
    commit,
    task_path: result.taskPath,
  });

  console.log(JSON.stringify({ task_id: taskId, status: 'completed', task_path: result.taskPath }, null, 2));
}

function needsHuman(taskId, rest, options) {
  const reason = commandValue(rest, '--reason');
  if (!reason) {
    throw new Error('needs-human requires --reason <text>');
  }

  const transitionId = eventId('needs-human', taskId);
  const result = updateTask(
    taskId,
    (task) => {
      task.status = 'needs_human';
      task.last_transition_event_id = transitionId;
      return task;
    },
    options,
  );

  appendResult(options, {
    task_id: taskId,
    status: 'needs_human',
    reason,
    task_path: result.taskPath,
  });

  console.log(JSON.stringify({ task_id: taskId, status: 'needs_human', task_path: result.taskPath }, null, 2));
}

function recentResults(options) {
  const { resultsPath } = ensureState(options);
  const text = readFileSync(resultsPath, 'utf8').trim();
  if (!text) {
    return [];
  }
  return text
    .split('\n')
    .slice(-8)
    .map((line) => JSON.parse(line));
}

function prompt(taskId, options) {
  ensureState(options);
  const entry = findTaskEntry(taskId, options);

  const context = readFileSync(resolve(options.stateDir, 'context.md'), 'utf8').trim();
  const recent = recentResults(options);

  console.log(`# Jess Single Task Worker

Task id: ${entry.task.id}
Task file: ${entry.taskPath}

${context}

## Task Snapshot

\`\`\`json
${JSON.stringify(taskSummary(entry.task), null, 2)}
\`\`\`

## Recent Loop Results

\`\`\`json
${JSON.stringify(recent, null, 2)}
\`\`\`

## Instructions

- Work only this task.
- Read \`AGENTS.md\`, the task file, and the referenced docs or source files before editing.
- Use focused tests first, then the smallest broader verification that proves the change.
- Commit code changes when the task is complete.
- To finish this task, run:

\`\`\`bash
node scripts/task-loop.mjs finish ${entry.task.id} --commit "\$(git rev-parse HEAD)" --note "short verification summary"
\`\`\`

- If the task needs human judgment, run:

\`\`\`bash
node scripts/task-loop.mjs needs-human ${entry.task.id} --reason "specific blocker"
\`\`\`
`);
}

function rebuild(options) {
  const existingTasks = readTaskEntries(options);
  const allLessLogText = existsSync(options.allLessLog) ? readFileSync(options.allLessLog, 'utf8') : '';
  const compiled = compileTaskRegistry({ existingTasks, allLessLogText });
  const existingById = new Map(existingTasks.map((entry) => [entry.task.id, entry]));

  for (const task of compiled) {
    const existing = existingById.get(task.id);
    if (existing) {
      writeTask(existing.taskPath, task);
    } else {
      createTask(task, options);
    }
  }

  console.log(JSON.stringify({ tasks: compiled.length }, null, 2));
}

function main() {
  const { command, rest, options } = parseArgs(process.argv.slice(2));

  if (options.help || !command) {
    usage();
    return;
  }

  ensureState(options);

  switch (command) {
    case 'rebuild':
      rebuild(options);
      break;
    case 'status': {
      const counts = status(options);
      if (options.json) {
        console.log(JSON.stringify(counts, null, 2));
      } else {
        console.log(
          `tasks total=${counts.total} ready=${counts.ready} open=${counts.open ?? 0} completed=${counts.completed ?? 0} needs_human=${counts.needs_human ?? 0}`,
        );
      }
      break;
    }
    case 'get': {
      const [taskId] = rest;
      if (!taskId) {
        throw new Error('get requires <task-id>');
      }
      printTask(findTaskEntry(taskId, options).task, options.json);
      break;
    }
    case 'next': {
      const [entry] = readyTasks(options);
      if (!entry) {
        console.error('No ready tasks.');
        process.exitCode = 1;
        return;
      }
      printTask(entry.task, options.json);
      break;
    }
    case 'prompt': {
      const [taskId] = rest;
      if (!taskId) {
        throw new Error('prompt requires <task-id>');
      }
      prompt(taskId, options);
      break;
    }
    case 'finish': {
      const [taskId] = rest;
      if (!taskId) {
        throw new Error('finish requires <task-id>');
      }
      finishTask(taskId, rest.slice(1), options);
      break;
    }
    case 'needs-human': {
      const [taskId] = rest;
      if (!taskId) {
        throw new Error('needs-human requires <task-id>');
      }
      needsHuman(taskId, rest.slice(1), options);
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
