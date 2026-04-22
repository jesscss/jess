#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findTaskFileById,
  getDefaultTaskIndexPath,
  getRepoRoot,
  listTaskSnapshots,
} from './lib/task-files.mjs';

const REPO_ROOT = getRepoRoot();
const DEFAULT_RUNTIME_DB = resolve(REPO_ROOT, 'state/task-runtime/runtime.sqlite');

function usage() {
  console.log(`Usage:
  node scripts/task-runtime/build-handoff-bundle.mjs --task-id <id> --out <dir> [options]

Options:
  --runtime-db <path>       Override runtime DB path
  --tasks-index <path>      Override tasks/index.json path
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const args = {
    runtimeDb: process.env.RUNTIME_DB || DEFAULT_RUNTIME_DB,
    tasksIndex: process.env.TASK_INDEX_PATH || getDefaultTaskIndexPath(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--task-id':
        args.taskId = argv[++i];
        break;
      case '--out':
        args.outDir = argv[++i];
        break;
      case '--runtime-db':
        args.runtimeDb = argv[++i];
        break;
      case '--tasks-index':
        args.tasksIndex = argv[++i];
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function assertRequired(value, name) {
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
}

function stableWriteJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sortEventsNewestFirst(events) {
  return [...events].sort((left, right) => {
    const tsCompare = right.ts.localeCompare(left.ts);
    if (tsCompare !== 0) {
      return tsCompare;
    }
    return right.event_id.localeCompare(left.event_id);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  assertRequired(args.taskId, '--task-id');
  assertRequired(args.outDir, '--out');

  const { task } = findTaskFileById(args.taskId, { indexPath: args.tasksIndex });
  const allTasks = listTaskSnapshots({ indexPath: args.tasksIndex }).map((entry) => entry.task);
  const sameTrackTasks = allTasks.filter((candidate) => candidate.track === task.track);
  const dependencyTasks = allTasks.filter((candidate) => task.depends_on.includes(candidate.id));
  const blockedByTasks = allTasks.filter((candidate) => task.blocked_by.includes(candidate.id));

  let taskEvents = [];
  let trackEvents = [];

  if (existsSync(args.runtimeDb)) {
    const { createRuntimeState } = await import('./runtime-state.mjs');
    const runtimeState = createRuntimeState(args.runtimeDb);

    try {
      taskEvents = sortEventsNewestFirst(runtimeState.listEvents(task.id));
      trackEvents = sortEventsNewestFirst(
        sameTrackTasks.flatMap((candidate) =>
          runtimeState.listEvents(candidate.id).map((event) => ({
            ...event,
            track_task_id: candidate.id,
          })),
        ),
      ).slice(0, 20);
    } finally {
      runtimeState.close();
    }
  }

  mkdirSync(args.outDir, { recursive: true });

  stableWriteJson(resolve(args.outDir, 'task_snapshot.json'), task);
  stableWriteJson(resolve(args.outDir, 'task_context.json'), {
    task_id: task.id,
    track: task.track,
    bucket: task.bucket,
    priority: task.priority,
    source_refs: task.source_refs,
    goal_refs: task.goal_refs,
    definition_of_done: task.definition_of_done,
    same_track_tasks: sameTrackTasks.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      status: candidate.status,
      priority: candidate.priority,
      last_transition_event_id: candidate.last_transition_event_id,
    })),
    dependency_tasks: dependencyTasks,
    blocked_by_tasks: blockedByTasks,
  });
  stableWriteJson(resolve(args.outDir, 'recent_events.json'), {
    task_id: task.id,
    task_events: taskEvents,
    track_events: trackEvents,
  });
  stableWriteJson(resolve(args.outDir, 'verification_policy.json'), {
    task_id: task.id,
    allowed_classifications: ['jess-bug', 'rebaseline', 'needs-human'],
    proof_expectations: task.proof_expectations,
    definition_of_done: task.definition_of_done,
    write_rules: [
      'workers may not directly update canonical task files',
      'workers may not directly update the runtime database',
      'coordinator approval is required for authoritative task-state transitions',
    ],
    required_submission_fields: [
      'task_id',
      'classification',
      'reason',
      'files_changed',
      'verification',
      'proof_refs',
      'candidate_commit',
      'candidate_branch',
      'unresolved_concerns',
    ],
  });
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
