import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import circleDependency from 'vite-plugin-circular-dependency';
import parseman from 'parseman/plugin';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve workspace packages to their `src/index.ts` FOR VITEST ONLY, via
 * exact-match aliases. Vitest is TS-aware (rewrites `.js`→`.ts`), so tests run
 * against current source with no lib rebuild and no stale-lib phantom failures.
 *
 * We deliberately do NOT use a `"source"` export condition for this: that
 * condition leaks to every resolver, including non-TS-aware loaders (the
 * `styles-config` config loader, native `require`), which then choke on core's
 * `.js` import specifiers (`Cannot find module core/src/tree/index.js`). An
 * alias is vitest-scoped, so those loaders keep resolving to built `lib`.
 * Exact-match (`^name$`) so only bare imports alias; subpaths fall through.
 */
function workspaceSrcAliases() {
  const alias: { find: RegExp; replacement: string }[] = [];
  for (const d of readdirSync(resolve(root, 'packages'))) {
    const pj = resolve(root, 'packages', d, 'package.json');
    const src = resolve(root, 'packages', d, 'src/index.ts');
    if (!existsSync(pj) || !existsSync(src)) continue;
    let name: string | undefined;
    try { name = JSON.parse(readFileSync(pj, 'utf8')).name; } catch { continue; }
    if (!name) continue;
    alias.push({ find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: src });
  }
  return alias;
}

/**
 * Resolve the Less.js `@less/test-data` corpus once at config load. The workspace
 * symlink is relative and resolves wrong in git worktrees (→ `worktrees/less.js`)
 * and `pnpm install` reintroduces it broken; a sibling `less.js` checkout beside
 * the main repo (git common dir) is the reliable anchor. Returns undefined if none.
 */
function lessTestDataRoot(): string | undefined {
  const env = process.env.LESS_TEST_DATA_ROOT;
  if (env && existsSync(resolve(env, 'tests-unit'))) return env;
  const candidates = [resolve(root, '../less.js/packages/test-data')];
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
    candidates.push(resolve(dirname(resolve(root, gitDir)), '../less.js/packages/test-data'));
  } catch { /* not a git checkout */ }
  return candidates.find(c => existsSync(resolve(c, 'tests-unit')));
}

export default defineConfig({
  plugins: [
    // Compiles grammars that import parseman `with { type: 'macro' }` at build
    // time. No-op for files without the macro attribute, so it's safe globally.
    parseman.vite(),
    circleDependency()
  ],
  resolve: {
    alias: workspaceSrcAliases(),
    mainFields: ['module', 'import', 'exports', 'main']
  },
  test: {
    /**
     * @todo - This doesn't work yet because the modules are mapped incorrectly somehow.
     *         But might make test running faster.
     */
    // experimental: {
    //   viteModuleRunner: false,
    // },
    watch: false,
    // Set TEST environment variable for packages that depend on it
    env: {
      TEST: 'true',
      // Resolve @less/test-data ONCE here (plain Node, reliable) so tests don't
      // depend on the relative workspace symlink that `pnpm install` reintroduces
      // broken in git worktrees. Empty string if not found (tests fall back).
      ...(lessTestDataRoot() ? { LESS_TEST_DATA_ROOT: lessTestDataRoot()! } : {})
    },
    // Ensure environment variables are passed to test processes
    environment: 'node',
    onConsoleLog(log, type) {
      process[type === 'stderr' ? 'stderr' : 'stdout'].write(log + '\n')
      return false
    },
    testTimeout: 30_000,
    reporters: [['tree', { summary: true }]],
    // Enable globals for describe, test, etc.
    globals: true,
    // Include all test files from all packages - use absolute paths relative to config file

    projects: [
      'packages/*',
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
            'packages/css-parser/test/perf.test.ts',
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
