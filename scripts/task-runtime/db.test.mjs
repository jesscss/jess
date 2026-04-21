import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openRuntimeDb } from './lib/db.mjs';

const compatibleDbPath = '/tmp/jess-task-runtime-unversioned.sqlite';
rmSync(compatibleDbPath, { force: true });

const compatibleSeedDb = new DatabaseSync(compatibleDbPath);
compatibleSeedDb.exec(`
  CREATE TABLE events (
    event_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    run_id TEXT,
    payload_json TEXT NOT NULL
  );

  CREATE TABLE task_runtime (
    task_id TEXT PRIMARY KEY,
    lease_owner TEXT,
    lease_expires_at TEXT,
    active_run_id TEXT,
    last_event_id TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    branch TEXT,
    worktree TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );

  CREATE TABLE submissions (
    submission_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    classification TEXT NOT NULL,
    candidate_commit TEXT,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);
compatibleSeedDb.close();

const db = openRuntimeDb(compatibleDbPath);
const { user_version: userVersion } = db.prepare('PRAGMA user_version').get();
assert.equal(userVersion, 1);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);
assert.deepEqual(tables, ['events', 'runs', 'submissions', 'task_runtime']);

db.close();

const incompatibleDbPath = '/tmp/jess-task-runtime-incompatible.sqlite';
rmSync(incompatibleDbPath, { force: true });

const incompatibleSeedDb = new DatabaseSync(incompatibleDbPath);
incompatibleSeedDb.exec(`
  CREATE TABLE events (
    event_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    ts TEXT NOT NULL
  );
`);
incompatibleSeedDb.close();

assert.throws(
  () => openRuntimeDb(incompatibleDbPath),
  /Unversioned task runtime database has incompatible runtime tables: events \(missing: actor, run_id, payload_json\)\./,
);

const incompatibleDb = new DatabaseSync(incompatibleDbPath);
const { user_version: incompatibleUserVersion } = incompatibleDb.prepare('PRAGMA user_version').get();
assert.equal(incompatibleUserVersion, 0);
incompatibleDb.close();
