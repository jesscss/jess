#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  findTaskFileById,
  getDefaultTaskIndexPath,
  getRepoRoot,
  updateTaskSnapshot,
} from './lib/task-files.mjs';

const REPO_ROOT = getRepoRoot();
const DEFAULT_RUNTIME_DB = resolve(REPO_ROOT, 'state/task-runtime/runtime.sqlite');
const EVENT_SCHEMA_PATH = resolve(REPO_ROOT, 'tasks/schema/event.schema.json');

const ajv = new Ajv2020({
  allErrors: true,
  formats: {
    'date-time': true,
  },
  strict: true,
});
const eventSchema = JSON.parse(readFileSync(EVENT_SCHEMA_PATH, 'utf8'));
const validateEvent = ajv.compile(eventSchema);

const ALLOWED_TRANSITIONS = new Map([
  ['open', new Set(['leased', 'in_progress', 'awaiting_review', 'completed', 'needs_human', 'rejected', 'superseded'])],
  ['leased', new Set(['open', 'in_progress', 'awaiting_review', 'completed', 'needs_human', 'rejected', 'superseded'])],
  ['in_progress', new Set(['open', 'awaiting_review', 'completed', 'needs_human', 'rejected', 'superseded'])],
  ['awaiting_review', new Set(['open', 'completed', 'needs_human', 'rejected', 'superseded'])],
  ['completed', new Set(['superseded'])],
  ['needs_human', new Set(['open', 'completed', 'superseded'])],
  ['rejected', new Set(['open', 'superseded'])],
  ['superseded', new Set()],
]);

function usage() {
  console.log(`Usage:
  node scripts/task-runtime/apply-transition.mjs --task-id <id> --status <status> --event-id <id> --event-type <type> --actor <actor> [options]

Options:
  --run-id <id>             Associate the transition with a runtime run id
  --accepted-run-id <id>    Update the task snapshot's accepted_run_id
  --accepted-commit <sha>   Update the task snapshot's accepted_commit
  --payload-json <json>     JSON payload recorded on the runtime event
  --runtime-db <path>       Override runtime DB path
  --tasks-index <path>      Override tasks/index.json path
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const args = {
    payloadJson: '{}',
    runtimeDb: process.env.RUNTIME_DB || DEFAULT_RUNTIME_DB,
    tasksIndex: process.env.TASK_INDEX_PATH || getDefaultTaskIndexPath(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--task-id':
        args.taskId = argv[++i];
        break;
      case '--status':
        args.status = argv[++i];
        break;
      case '--event-id':
        args.eventId = argv[++i];
        break;
      case '--event-type':
        args.eventType = argv[++i];
        break;
      case '--actor':
        args.actor = argv[++i];
        break;
      case '--run-id':
        args.runId = argv[++i];
        break;
      case '--accepted-run-id':
        args.acceptedRunId = argv[++i];
        break;
      case '--accepted-commit':
        args.acceptedCommit = argv[++i];
        break;
      case '--payload-json':
        args.payloadJson = argv[++i];
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

function assertAllowedTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return;
  }

  const allowed = ALLOWED_TRANSITIONS.get(fromStatus);
  if (!allowed?.has(toStatus)) {
    throw new Error(`Invalid task transition: ${fromStatus} -> ${toStatus}`);
  }
}

function parsePayload(payloadJson) {
  try {
    const payload = JSON.parse(payloadJson);
    if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error('payload must be a JSON object');
    }
    return payload;
  } catch (error) {
    throw new Error(`Invalid --payload-json: ${error.message}`);
  }
}

function buildEvent(args, payload) {
  const event = {
    event_id: args.eventId,
    task_id: args.taskId,
    event_type: args.eventType,
    ts: new Date().toISOString(),
    actor: args.actor,
    run_id: args.runId ?? null,
    payload: {
      ...payload,
      to_status: args.status,
      accepted_commit: args.acceptedCommit ?? null,
      accepted_run_id: args.acceptedRunId ?? null,
    },
  };

  if (!validateEvent(event)) {
    const details = (validateEvent.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    throw new Error(`Transition event validation failed: ${details}`);
  }

  return event;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    return;
  }

  assertRequired(args.taskId, '--task-id');
  assertRequired(args.status, '--status');
  assertRequired(args.eventId, '--event-id');
  assertRequired(args.eventType, '--event-type');
  assertRequired(args.actor, '--actor');

  const payload = parsePayload(args.payloadJson);
  const { task } = findTaskFileById(args.taskId, { indexPath: args.tasksIndex });
  assertAllowedTransition(task.status, args.status);

  const event = buildEvent(args, payload);
  const { createRuntimeState } = await import('./runtime-state.mjs');
  const runtimeState = createRuntimeState(args.runtimeDb);

  try {
    runtimeState.insertEvent(event);
    const { taskPath, nextTask } = updateTaskSnapshot(
      args.taskId,
      (currentTask) => {
        currentTask.status = args.status;
        currentTask.last_transition_event_id = args.eventId;

        if (args.acceptedCommit !== undefined) {
          currentTask.accepted_commit = args.acceptedCommit;
        }

        if (args.acceptedRunId !== undefined) {
          currentTask.accepted_run_id = args.acceptedRunId;
        }

        return currentTask;
      },
      { indexPath: args.tasksIndex },
    );

    console.log(
      JSON.stringify(
        {
          task_id: args.taskId,
          task_path: taskPath,
          status: nextTask.status,
          event_id: args.eventId,
        },
        null,
        2,
      ),
    );
  } finally {
    runtimeState.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
