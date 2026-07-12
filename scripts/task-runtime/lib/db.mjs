import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;
const RUNTIME_TABLES = new Set(['events', 'runs', 'submissions', 'task_runtime']);
const REQUIRED_COLUMNS_BY_TABLE = {
  events: ['event_id', 'task_id', 'event_type', 'ts', 'actor', 'run_id', 'payload_json'],
  runs: ['run_id', 'task_id', 'branch', 'worktree', 'status', 'started_at', 'finished_at'],
  submissions: [
    'submission_id',
    'run_id',
    'task_id',
    'classification',
    'candidate_commit',
    'summary_json',
    'created_at',
  ],
  task_runtime: [
    'task_id',
    'lease_owner',
    'lease_expires_at',
    'active_run_id',
    'last_event_id',
    'updated_at',
  ],
};

function getUserVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

function listUserTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

function hasOnlyKnownRuntimeTables(tables) {
  return tables.every((name) => RUNTIME_TABLES.has(name));
}

function getTableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}

function findIncompatibleRuntimeTables(db, tables) {
  const incompatible = [];

  for (const tableName of tables) {
    const requiredColumns = REQUIRED_COLUMNS_BY_TABLE[tableName];
    if (!requiredColumns) {
      continue;
    }

    const existingColumns = new Set(getTableColumns(db, tableName));
    const missingColumns = requiredColumns.filter((column) => !existingColumns.has(column));
    if (missingColumns.length > 0) {
      incompatible.push(`${tableName} (missing: ${missingColumns.join(', ')})`);
    }
  }

  return incompatible;
}

export function openRuntimeDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA foreign_keys = ON');

  const currentVersion = getUserVersion(db);

  if (currentVersion === 0) {
    const existingTables = listUserTables(db);

    if (existingTables.length > 0 && !hasOnlyKnownRuntimeTables(existingTables)) {
      db.close();
      throw new Error(
        `Unversioned task runtime database already contains tables: ${existingTables.join(', ')}. ` +
          'Run an explicit migration or remove the database and reinitialize it.',
      );
    }

    const incompatibleTables = findIncompatibleRuntimeTables(db, existingTables);
    if (incompatibleTables.length > 0) {
      db.close();
      throw new Error(
        `Unversioned task runtime database has incompatible runtime tables: ${incompatibleTables.join('; ')}. ` +
          'Run an explicit migration or remove the database and reinitialize it.',
      );
    }

    const schema = readFileSync(path.resolve(__dirname, '../runtime-schema.sql'), 'utf8');
    db.exec(schema);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return db;
  }

  if (currentVersion !== SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `Unsupported task runtime schema version: ${currentVersion}. Expected ${SCHEMA_VERSION}.`,
    );
  }

  return db;
}
