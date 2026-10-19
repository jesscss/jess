import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import circleDependency from 'vite-plugin-circular-dependency';
import parseman from 'parseman/plugin';
import { workspaceSrcAliases } from './scripts/workspace-src-aliases.mjs';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the Less.js `@less/test-data` corpus once at config load. The workspace
 * symlink is relative and resolves wrong in git worktrees (→ `worktrees/less.js`)
 * and `pnpm install` reintroduces it broken; a sibling `less.js` checkout beside
 * the main repo (git common dir) is the reliable anchor. Returns undefined if none.
 */
function lessTestDataRoot(): string | undefined {
  const env = process.env.LESS_TEST_DATA_ROOT;
  if (env && existsSync(resolve(env, 'tests-unit'))) {
    return env;
  }
  const candidates = [resolve(root, '../less.js/packages/test-data')];
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
    candidates.push(resolve(dirname(resolve(root, gitDir)), '../less.js/packages/test-data'));
  } catch { /* not a git checkout */ }
  return candidates.find(c => existsSync(resolve(c, 'tests-unit')));
}

export default defineConfig({
  plugins: [
    /*
     * Compiles grammars that import parseman `with { type: 'macro' }` at build
     * time. No-op for files without the macro attribute, so it's safe globally.
     */
    parseman.vite({}),

    /*
     * Circular-import detection is a CI/pre-push guardrail, not a per-run need:
     * it only warns (no failing gate) yet runs on every module transform. Gate it
     * behind an env flag so local/watch test runs skip the transform overhead.
     */
    ...(process.env.VITEST_CIRCULAR === 'true' ? [circleDependency()] : [])
  ],
  resolve: {
    alias: workspaceSrcAliases(root),
    mainFields: ['module', 'import', 'exports', 'main']
  },
  test: {
    /**
     * @todo - This doesn't work yet because the modules are mapped incorrectly somehow.
     *         But might make test running faster.
     */
    /*
     * experimental: {
     * viteModuleRunner: false,
     * },
     */
    watch: false,

    /*
     * Share one module registry across test files within a worker instead of
     * re-executing the whole source-aliased graph per file. Every `@jesscss/*`
     * resolves to `src/*` here (see workspaceSrcAliases), so isolate:true made
     * each of ~478 files re-transform and re-run the entire core AST/eval graph
     * — measured as tens of seconds of import per package with sub-2s of actual
     * test time. The handful of tests that need a fresh module capture (extend
     * profile-counter gates) force their own via `vi.resetModules()`.
     */
    isolate: false,

    // Set TEST environment variable for packages that depend on it
    env: {
      TEST: 'true',

      /*
       * Resolve @less/test-data ONCE here (plain Node, reliable) so tests don't
       * depend on the relative workspace symlink that `pnpm install` reintroduces
       * broken in git worktrees. Empty string if not found (tests fall back).
       */
      ...(lessTestDataRoot() ? { LESS_TEST_DATA_ROOT: lessTestDataRoot()! } : {})
    },

    // Ensure environment variables are passed to test processes
    environment: 'node',
    onConsoleLog(log, type) {
      process[type === 'stderr' ? 'stderr' : 'stdout'].write(log + '\n');
      return false;
    },
    testTimeout: 30_000,

    /*
     * Test BODIES already get 30s; hooks kept the 10s default, which is too tight
     * for the profile-counter suites (extend-op-budget, extend-preflight-contract,
     * *.profile.test.ts). Those must `vi.resetModules()` + reimport the core graph
     * to install a counter bag BEFORE core loads — a principled requirement, since
     * capturing the bag in a `const` at import is what lets production elide the
     * recorder entirely (a swappable binding would leave a hot-path check). Under a
     * saturated `pnpm -r test`, that one source-alias reimport can exceed 10s though
     * it runs in <1s solo. Give hooks the same headroom as test bodies.
     */
    hookTimeout: 60_000,
    reporters: [['tree', { summary: true }]],

    // Enable globals for describe, test, etc.
    globals: true,

    // Include all test files from all packages - use absolute paths relative to config file

    projects: [
      'packages/**/vitest.config.ts',
      {
        extends: true,
        test: {
          include: [
            '**/__tests__/**/*.test.ts',
            '**/__tests__/**/*.spec.ts',
            'test/**/*.test.ts',
            'test/**/*.spec.ts'
          ],
          exclude: [
            'test/setup.ts',
            'node_modules/**',
            'dist/**',
            'lib/**',
            '.claude/**',
            'tmp/**',

            /* (a `css-parser/test/perf.test.ts` exclude used to sit here; no
             * such file exists anywhere under packages/syntax any more) */
            '**/*bench*'
          ]
        }
      }
    ],

    // Global setup file - use absolute path so it works from any subfolder
    setupFiles: [resolve(__dirname, './test/setup.ts')],

    // Disable coverage by default to save memory
    coverage: {
      enabled: false,
      provider: 'v8'
    }
  }
});
