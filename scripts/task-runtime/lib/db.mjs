import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;

function getUserVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

export function openRuntimeDb(dbPath) {
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA foreign_keys = ON');

  const currentVersion = getUserVersion(db);

  if (currentVersion === 0) {
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
