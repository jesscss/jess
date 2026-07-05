import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(import.meta.url);

function existingDirectory(value: string | undefined): string | undefined {
  if (!value) {
    return;
  }
  const resolved = path.resolve(value);
  try {
    return statSync(resolved).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function findGitFile(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, '.git');
    if (existingDirectory(candidate) || existingFile(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

function existingFile(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    return statSync(path.resolve(value)).isFile();
  } catch {
    return false;
  }
}

function gitCommonRepoRoot(): string | undefined {
  try {
    const gitPath = findGitFile(process.cwd());
    if (!gitPath || existingDirectory(gitPath)) {
      return;
    }
    const gitFile = readFileSync(gitPath, 'utf8');
    const match = /^gitdir:\s*(.+)$/m.exec(gitFile);
    if (!match) {
      return;
    }
    const gitDir = path.resolve(path.dirname(gitPath), match[1]!);
    const worktreesDir = path.basename(path.dirname(gitDir));
    if (worktreesDir !== 'worktrees') {
      return;
    }
    return path.dirname(path.dirname(path.dirname(gitDir)));
  } catch {
    return undefined;
  }
}

/**
 * Resolve the Less.js test-data package from either the package test context,
 * the workspace root dev dependency, or a sibling Less.js checkout beside the
 * main Jess repository. Keeping this in one helper avoids per-test path
 * guesses while still letting isolated worktrees run the shared corpus.
 */
export function resolveLessTestDataRoot(): string {
  const envRoot = existingDirectory(process.env.LESS_TEST_DATA_ROOT);
  if (envRoot) {
    return envRoot;
  }

  try {
    return path.dirname(require.resolve('@less/test-data'));
  } catch {
    // Continue to workspace and checkout fallbacks below.
  }

  try {
    const rootRequire = createRequire(path.join(process.cwd(), 'package.json'));
    return path.dirname(rootRequire.resolve('@less/test-data'));
  } catch {
    // Continue to checkout fallbacks below.
  }

  const candidates = [path.resolve(process.cwd(), '../less.js/packages/test-data')];
  const mainRepoRoot = gitCommonRepoRoot();
  if (mainRepoRoot) {
    candidates.push(path.resolve(mainRepoRoot, '../less.js/packages/test-data'));
  }
  for (const candidate of candidates) {
    const resolved = existingDirectory(candidate);
    if (resolved) {
      return resolved;
    }
  }

  throw new Error(
    'Unable to resolve @less/test-data. Set LESS_TEST_DATA_ROOT to the Less.js packages/test-data directory.'
  );
}
