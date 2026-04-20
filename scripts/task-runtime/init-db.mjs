import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openRuntimeDb } from './lib/db.mjs';

const args = process.argv.slice(2);
const dbFlag = args.indexOf('--db');

if (dbFlag === -1 || !args[dbFlag + 1]) {
  console.error('Usage: node scripts/task-runtime/init-db.mjs --db <path>');
  process.exit(2);
}

const dbPath = path.resolve(args[dbFlag + 1]);
mkdirSync(path.dirname(dbPath), { recursive: true });

const db = openRuntimeDb(dbPath);
db.prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').all('table');
db.close();

console.log(dbPath);
