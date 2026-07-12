#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  createTaskSnapshot,
  findTaskFileById,
  getDefaultTaskIndexPath,
  getRepoRoot,
  listTaskSnapshots,
  updateTaskSnapshot,
} from './lib/task-files.mjs';

const REPO_ROOT = getRepoRoot();
const DEFAULT_RUNTIME_DB = resolve(REPO_ROOT, 'state/task-runtime/runtime.sqlite');
const EVENT_SCHEMA_PATH = resolve(REPO_ROOT, 'tasks/schema/event.schema.json');
const PRIORITIES = new Set(['p0', 'p1', 'p2', 'p3']);
const ACTIVE_STATUSES = new Set(['open', 'leased', 'in_progress', 'awaiting_review', 'needs_human', 'rejected']);

const ajv = new Ajv2020({
  allErrors: true,
  formats: {
    'date-time': true,
  },
  strict: true,
});
const eventSchema = JSON.parse(readFileSync(EVENT_SCHEMA_PATH, 'utf8'));
const validateEvent = ajv.compile(eventSchema);

function usage() {
  console.log(`Usage:
  node scripts/task-runtime/operator-tasks.mjs <command> [args] [options]

Commands:
  status [--track <track>] [--json]
  prioritize <task-id> <priority> [--propose]
  add <task-id> <title> [--track <track>] [--bucket <bucket>] [--priority <priority>] [--propose]
  block <task-id> <reason> [--propose]
  focus <track> [--priority <priority>] [--propose]

Options:
  --runtime-db <path>       Override runtime DB path
  --tasks-index <path>      Override tasks/index.json path
  --help                    Show this help
`);
}

function parseGlobalOptions(argv) {
  const args = [];
  const options = {
    runtimeDb: process.env.RUNTIME_DB || DEFAULT_RUNTIME_DB,
    tasksIndex: process.env.TASK_INDEX_PATH || getDefaultTaskIndexPath(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--runtime-db') {
      options.runtimeDb = argv[++i];
      continue;
    }
    if (arg === '--tasks-index') {
      options.tasksIndex = argv[++i];
      continue;
    }
    args.push(arg);
  }

  return { args, options };
}

function nowIso() {
  return new Date().toISOString();
}

function eventId(command, target) {
  return `operator:${command}:${target}:${Date.now()}`;
}

function assertEvent(event) {
  if (validateEvent(event)) {
    return;
  }

  const details = (validateEvent.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  throw new Error(`Operator event validation failed: ${details}`);
}

function insertEvent(runtimeState, { command, taskId, payload, eventType = `operator_${command}`, actor = 'operator', runId = null }) {
  const event = {
    event_id: eventId(command, taskId),
    task_id: taskId,
    event_type: eventType,
    ts: nowIso(),
    actor,
    run_id: runId,
    payload,
  };
  assertEvent(event);
  runtimeState.insertEvent(event);
  return event;
}

function printStatus(tasks, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  for (const task of tasks) {
    console.log(`${task.id}\t${task.priority}\t${task.status}\t${task.track}\t${task.title}`);
  }
}

function parseCommandArgs(args) {
  const [command, ...rest] = args;
  switch (command) {
    case 'status': {
      let track = null;
      let asJson = false;
      for (let i = 0; i < rest.length; i += 1) {
        if (rest[i] === '--track') {
          track = rest[++i];
        } else if (rest[i] === '--json') {
          asJson = true;
        } else {
          throw new Error(`Unknown status argument: ${rest[i]}`);
        }
      }
      return { command, track, asJson };
    }
    case 'prioritize':
      return {
        command,
        taskId: rest[0],
        priority: rest[1],
        propose: rest.includes('--propose'),
      };
    case 'add': {
      const propose = rest.includes('--propose');
      const filtered = rest.filter((item) => item !== '--propose');
      const taskId = filtered.shift();
      const title = filtered.shift();
      let track = 'repo-wide-rollout';
      let bucket = 'operator-added';
      let priority = 'p2';
      for (let i = 0; i < filtered.length; i += 1) {
        if (filtered[i] === '--track') {
          track = filtered[++i];
        } else if (filtered[i] === '--bucket') {
          bucket = filtered[++i];
        } else if (filtered[i] === '--priority') {
          priority = filtered[++i];
        } else {
          throw new Error(`Unknown add argument: ${filtered[i]}`);
        }
      }
      return { command, taskId, title, track, bucket, priority, propose };
    }
    case 'block': {
      const propose = rest.includes('--propose');
      const filtered = rest.filter((item) => item !== '--propose');
      return {
        command,
        taskId: filtered[0],
        reason: filtered.slice(1).join(' '),
        propose,
      };
    }
    case 'focus': {
      const propose = rest.includes('--propose');
      const filtered = rest.filter((item) => item !== '--propose');
      const track = filtered.shift();
      let priority = 'p1';
      for (let i = 0; i < filtered.length; i += 1) {
        if (filtered[i] === '--priority') {
          priority = filtered[++i];
        } else {
          throw new Error(`Unknown focus argument: ${filtered[i]}`);
        }
      }
      return { command, track, priority, propose };
    }
    default:
      throw new Error(`Unknown command: ${command ?? '(missing)'}`);
  }
}

function assertPriority(priority) {
  if (!PRIORITIES.has(priority)) {
    throw new Error(`Invalid priority: ${priority}`);
  }
}

function requireValue(value, label) {
  if (!value) {
    throw new Error(`Missing required value: ${label}`);
  }
}

function summarizeMutation(summary) {
  console.log(JSON.stringify(summary, null, 2));
}

function getEffectiveTaskStatus(task, runtimeState) {
  if (!runtimeState) {
    return task.status;
  }

  const runtimeStatus = runtimeState.getTaskStatus(task.id);
  return task.status === 'open' && runtimeStatus !== 'open' ? runtimeStatus : task.status;
}

async function main() {
  const { args, options } = parseGlobalOptions(process.argv.slice(2));
  if (options.help || args.length === 0) {
    usage();
    return;
  }

  const command = parseCommandArgs(args);
  const tasks = listTaskSnapshots({ indexPath: options.tasksIndex }).map((entry) => entry.task);
  const shouldOpenRuntimeDb = command.command !== 'status' || existsSync(options.runtimeDb);
  const runtimeState = shouldOpenRuntimeDb
    ? (await import('./runtime-state.mjs')).createRuntimeState(options.runtimeDb)
    : null;

  try {
    switch (command.command) {
      case 'status': {
        const visibleTasks = (command.track ? tasks.filter((task) => task.track === command.track) : tasks).map((task) => ({
          ...task,
          status: getEffectiveTaskStatus(task, runtimeState),
        }));
        printStatus(visibleTasks, command.asJson);
        break;
      }
      case 'prioritize': {
        requireValue(command.taskId, 'task-id');
        requireValue(command.priority, 'priority');
        assertPriority(command.priority);
        const { task } = findTaskFileById(command.taskId, { indexPath: options.tasksIndex });
        const payload = {
          task_id: task.id,
          previous_priority: task.priority,
          next_priority: command.priority,
          propose: command.propose,
        };
        const event = insertEvent(runtimeState, {
          command: command.propose ? 'propose_prioritize' : 'prioritize',
          taskId: task.id,
          payload,
        });
        if (!command.propose) {
          updateTaskSnapshot(
            task.id,
            (currentTask) => {
              currentTask.priority = command.priority;
              currentTask.last_transition_event_id = event.event_id;
              return currentTask;
            },
            { indexPath: options.tasksIndex },
          );
        }
        summarizeMutation({ task_id: task.id, priority: command.priority, proposed: command.propose, event_id: event.event_id });
        break;
      }
      case 'add': {
        requireValue(command.taskId, 'task-id');
        requireValue(command.title, 'title');
        assertPriority(command.priority);
        if (tasks.some((task) => task.id === command.taskId)) {
          throw new Error(`Task already exists: ${command.taskId}`);
        }
        const task = {
          id: command.taskId,
          title: command.title,
          track: command.track,
          bucket: command.bucket,
          priority: command.priority,
          status: 'open',
          source_refs: ['operator:add'],
          goal_refs: ['operator-added task'],
          depends_on: [],
          blocked_by: [],
          definition_of_done: 'Operator-defined task must be refined with concrete proof expectations.',
          proof_expectations: ['operator refinement required'],
          accepted_commit: null,
          accepted_run_id: null,
          last_transition_event_id: null,
        };

        const payload = {
          task_id: task.id,
          title: task.title,
          track: task.track,
          bucket: task.bucket,
          priority: task.priority,
          propose: command.propose,
        };
        const event = insertEvent(runtimeState, {
          command: command.propose ? 'propose_add' : 'add',
          taskId: task.id,
          payload,
        });
        if (!command.propose) {
          task.last_transition_event_id = event.event_id;
          createTaskSnapshot(task, { indexPath: options.tasksIndex });
        }
        summarizeMutation({ task_id: task.id, created: !command.propose, proposed: command.propose, event_id: event.event_id });
        break;
      }
      case 'block': {
        requireValue(command.taskId, 'task-id');
        requireValue(command.reason, 'reason');
        const { task } = findTaskFileById(command.taskId, { indexPath: options.tasksIndex });
        if (task.status === 'completed' || task.status === 'superseded') {
          throw new Error(`Cannot block task in terminal status: ${task.status}`);
        }
        const payload = {
          task_id: task.id,
          previous_status: task.status,
          next_status: 'needs_human',
          reason: command.reason,
          propose: command.propose,
        };
        const event = insertEvent(runtimeState, {
          command: command.propose ? 'propose_block' : 'block',
          taskId: task.id,
          payload,
          eventType: command.propose ? 'operator_proposed_block' : 'task_needs_human',
        });
        if (!command.propose) {
          updateTaskSnapshot(
            task.id,
            (currentTask) => {
              currentTask.status = 'needs_human';
              currentTask.last_transition_event_id = event.event_id;
              return currentTask;
            },
            { indexPath: options.tasksIndex },
          );
        }
        summarizeMutation({ task_id: task.id, status: command.propose ? task.status : 'needs_human', proposed: command.propose, event_id: event.event_id });
        break;
      }
      case 'focus': {
        requireValue(command.track, 'track');
        assertPriority(command.priority);
        const targets = tasks.filter(
          (task) => task.track === command.track && ACTIVE_STATUSES.has(task.status) && task.priority !== 'p0' && task.priority !== command.priority,
        );
        const payload = {
          track: command.track,
          target_count: targets.length,
          target_ids: targets.map((task) => task.id),
          next_priority: command.priority,
          propose: command.propose,
        };
        const summaries = [];
        for (const task of targets) {
          const event = insertEvent(runtimeState, {
            command: command.propose ? 'propose_focus' : 'focus',
            taskId: task.id,
            payload: {
              ...payload,
              task_id: task.id,
              previous_priority: task.priority,
            },
          });
          if (!command.propose) {
            updateTaskSnapshot(
              task.id,
              (currentTask) => {
                currentTask.priority = command.priority;
                currentTask.last_transition_event_id = event.event_id;
                return currentTask;
              },
              { indexPath: options.tasksIndex },
            );
          }
          summaries.push({
            task_id: task.id,
            previous_priority: task.priority,
            priority: command.propose ? task.priority : command.priority,
            event_id: event.event_id,
          });
        }
        summarizeMutation({ track: command.track, proposed: command.propose, changed: summaries });
        break;
      }
      default:
        throw new Error(`Unhandled command: ${command.command}`);
    }
  } finally {
    runtimeState?.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
