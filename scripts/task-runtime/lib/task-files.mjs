import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '../../..');
const DEFAULT_TASK_INDEX_PATH = resolve(REPO_ROOT, 'tasks/index.json');
const DEFAULT_TASK_SCHEMA_PATH = resolve(REPO_ROOT, 'tasks/schema/task.schema.json');

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

const taskSchema = JSON.parse(readFileSync(DEFAULT_TASK_SCHEMA_PATH, 'utf8'));
const validateTaskSchema = ajv.compile(taskSchema);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function uniqueTaskDirectories(taskDirectories = []) {
  return [...new Set(taskDirectories.map((entry) => entry.directory))];
}

function taskDirectories(indexPath) {
  const index = readJson(indexPath);
  const repoRoot = dirname(dirname(indexPath));
  return uniqueTaskDirectories(index.task_directories).map((directory) => resolve(repoRoot, directory));
}

export function getRepoRoot() {
  return REPO_ROOT;
}

export function getDefaultTaskIndexPath() {
  return DEFAULT_TASK_INDEX_PATH;
}

export function validateTaskSnapshot(task) {
  if (validateTaskSchema(task)) {
    return;
  }

  const details = (validateTaskSchema.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  throw new Error(`Task snapshot validation failed: ${details}`);
}

export function findTaskFileById(taskId, options = {}) {
  const indexPath = resolve(options.indexPath ?? DEFAULT_TASK_INDEX_PATH);

  for (const directory of taskDirectories(indexPath)) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const taskPath = join(directory, entry.name);
      const task = readJson(taskPath);
      if (task.id === taskId) {
        return { taskPath, task, indexPath };
      }
    }
  }

  throw new Error(`Could not find canonical task snapshot for id "${taskId}"`);
}

export function writeTaskSnapshot(taskPath, task) {
  validateTaskSnapshot(task);

  const tempDir = mkdtempSync(join(tmpdir(), 'jess-task-'));
  const tempPath = join(tempDir, basename(taskPath));

  try {
    writeFileSync(tempPath, stableJson(task), 'utf8');
    renameSync(tempPath, taskPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function updateTaskSnapshot(taskId, updater, options = {}) {
  const { taskPath, task, indexPath } = findTaskFileById(taskId, options);
  const nextTask = updater(structuredClone(task), { taskPath, indexPath });

  validateTaskSnapshot(nextTask);
  writeTaskSnapshot(taskPath, nextTask);

  return {
    taskPath,
    previousTask: task,
    nextTask,
  };
}
