/**
 * Synchronous debug logging utility for tests.
 * This file is in __tests__ so it won't be included in the public API.
 */
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Find monorepo root by looking for pnpm-workspace.yaml
function findMonorepoRoot(start: string): string {
  let dir = start;
  while (dir !== '/') {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return process.cwd();
}

const ROOT = findMonorepoRoot(__dirname);
const LOG_DIR = join(ROOT, '.cursor');
const LOG_PATH = process.env.DEBUG_LOG_PATH || join(LOG_DIR, 'debug.log');

// Ensure directory exists
try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}

export const syncLog = (data: object) => {
  try {
    appendFileSync(LOG_PATH, JSON.stringify(data) + '\n');
  } catch {
    // Ignore errors
  }
};
