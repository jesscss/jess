import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve the upstream Less test-data corpus for CSS output compatibility tests.
 *
 * The package-level Vitest context does not always see the root workspace's
 * linked `@less/test-data` package, especially from isolated git worktrees.
 * Keep the lookup explicit so corpus gates do not silently disappear when the
 * local checkout layout changes.
 */
export function resolveLessTestDataRoot(): string {
  if (process.env.LESS_TEST_DATA_ROOT) {
    return process.env.LESS_TEST_DATA_ROOT;
  }

  const packageRequire = createRequire(import.meta.url);
  const rootRequire = createRequire(path.resolve(process.cwd(), '../../package.json'));

  const candidates: string[] = [];
  for (const requireFn of [packageRequire, rootRequire]) {
    try {
      candidates.push(path.dirname(requireFn.resolve('@less/test-data')));
    } catch {
      // Try the filesystem fallbacks below.
    }
  }

  candidates.push(path.resolve(process.cwd(), '../less.js/packages/test-data'));
  candidates.push(path.resolve(process.cwd(), '../../../../../git/oss/less.js/packages/test-data'));
  if (process.env.HOME) {
    candidates.push(path.resolve(process.env.HOME, 'git/oss/less.js/packages/test-data'));
  }

  const found = candidates.find(candidate => fs.existsSync(path.join(candidate, 'tests-unit')));
  if (!found) {
    throw new Error('Unable to resolve @less/test-data. Set LESS_TEST_DATA_ROOT to the Less.js packages/test-data directory.');
  }

  return found;
}
