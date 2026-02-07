/**
 * Synchronous debug logging utility for tests.
 * This file is in __tests__ so it won't be included in the public API.
 */
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = findMonorepoRoot(__dirname);

function getLogPath(): string {
  if (process.env.DEBUG_LOG_PATH) return process.env.DEBUG_LOG_PATH;
  const logDir = process.env.DEBUG_LOG_DIR || join(ROOT, '.cursor');
  return join(logDir, 'debug.log');
}

export function getDebugLogPath(): string {
  return getLogPath();
}

export const syncLog = (data: object) => {
  try {
    const logPath = getLogPath();
    const logDir = dirname(logPath);
    mkdirSync(logDir, { recursive: true });
    appendFileSync(logPath, JSON.stringify(data) + '\n');
  } catch {
    // Ignore errors
  }
};
