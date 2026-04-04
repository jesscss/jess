import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

function getSyncLogPath(): string {
  if (process.env.DEBUG_LOG_PATH) {
    return process.env.DEBUG_LOG_PATH;
  }
  const root = findMonorepoRoot(process.cwd());
  return join(root, '.cursor', 'debug.log');
}

export function syncLog(data: Record<string, unknown>): void {
  try {
    appendFileSync(getSyncLogPath(), `${JSON.stringify(data)}\n`);
  } catch {
    // Ignore logging failures in debug mode.
  }
}
