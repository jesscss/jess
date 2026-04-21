import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;

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

export function openRuntimeDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA foreign_keys = ON');

  const currentVersion = getUserVersion(db);

  if (currentVersion === 0) {
    const existingTables = listUserTables(db);

    if (existingTables.length > 0) {
      db.close();
      throw new Error(
        `Unversioned task runtime database already contains tables: ${existingTables.join(', ')}. ` +
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
