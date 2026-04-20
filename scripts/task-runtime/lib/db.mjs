import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openRuntimeDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  const schema = readFileSync(path.resolve(__dirname, '../runtime-schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}
