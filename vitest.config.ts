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
 *
 * The scan RECURSES into grouping directories. `e96d1035d` regrouped packages by
 * syntax (`packages/less-parser` -> `packages/syntax/less/less-parser`), which put
 * nine packages — including all four parsers — below the single directory level
 * this loop used to scan. They silently stopped being aliased. Nothing failed
 * loudly: consumers inside the workspace still resolved through their own
 * `node_modules` symlink to built `lib`, so the only visible symptom was a
 * root-level test importing a parser dying with ERR_MODULE_NOT_FOUND — which is
 * exactly how `test/ast-shape/shape-stability.test.ts` (the invariant-1 gate)
 * came to be dead-but-quiet. A grouping directory has no `package.json`, so
 * "descend until a package is found" distinguishes the two cases without a
 * hard-coded depth or a list of group names to keep in sync.
 */
function workspaceSrcAliases() {
  const alias: { find: RegExp; replacement: string }[] = [];

  const visit = (dir: string, depth: number): void => {
    /*
     * Cycle guard only. Deliberately well ABOVE the current maximum nesting
     * (`packages/syntax/css/css-parser` is depth 3): a bound set exactly at
     * today's depth would silently drop the first package anyone nests one
     * level deeper, which is the exact failure this whole function was just
     * repaired for. Recursion already stops at the first `package.json` and
     * skips `node_modules`, so this never walks a dependency tree.
     */
    if (depth > 6) {
      return;
    }
    const pj = resolve(dir, 'package.json');
    if (existsSync(pj)) {
      const src = resolve(dir, 'src/index.ts');
      if (!existsSync(src)) {
        return;
      }
      let name: string | undefined;
      try {
        name = JSON.parse(readFileSync(pj, 'utf8')).name;
      } catch {
        return;
      }
      if (!name) {
        return;
      }
      alias.push({ find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: src });
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) {
        continue;
      }
      visit(resolve(dir, entry), depth + 1);
    }
  };

  visit(resolve(root, 'packages'), 0);

  /*
   * CSS-parser subpaths used by source-aliased workspace parsers. Subpaths
   * normally fall through to node resolution, which misses from a consuming
   * package when the direct parser package itself has been aliased to `src`.
   * These aliases preserve the same source-to-source graph that the built
   * package exports provide to production consumers.
  */
  /*
   * NOTE: a `@jesscss/css-parser/jess` alias used to sit here, guarded by
   * existsSync against `src/jess.ts`. That file is gone, the package no longer
   * exports `./jess`, and nothing imports it — so the guard made it a silent
   * no-op rather than an error. Removed; re-add only alongside a real export.
   */
  const cssGrammar = resolve(root, 'packages/syntax/css/css-parser/src/grammar.ts');
  if (existsSync(cssGrammar)) {
    alias.push({ find: /^@jesscss\/css-parser\/grammar$/, replacement: cssGrammar });
  }

  /*
   * `./cst` for every dialect, for the same reason. This subpath matters more
   * than the two above: `less-parser/src/cst.ts` imports
   * `@jesscss/css-parser/cst`, so once the bare parser names resolve to `src`,
   * leaving `/cst` on node resolution would build a HALF-source graph — a
   * source-side less CST wrapping a lib-side css CST builder. The shape gate
   * reads `buildCssCstNode`'s output, so that split would have it measuring the
   * previously built `lib` while reporting on `src`.
   */
  /*
   * css-parser's `./cst` public entry is `src/cst-css.ts` (the `parseCssCst`
   * wrappers); its `src/cst.ts` is the shared builder those wrappers call, and
   * is NOT the package's `./cst` export. The other three map straight across.
   */
  for (const [dialect, file] of [
    ['css', 'cst-css.ts'],
    ['less', 'cst.ts'],
    ['scss', 'cst.ts'],
    ['jess', 'cst.ts']
  ]) {
    const cst = resolve(root, `packages/syntax/${dialect}/${dialect}-parser/src/${file}`);

    /*
     * THROWS rather than existsSync-skipping. These four are expected to exist;
     * degrading to a no-op would rebuild the half-source graph described above
     * and report nothing — the same silent-miss that killed the shape gate, and
     * the reason the dead `@jesscss/css-parser/jess` alias above was removed.
     */
    if (!existsSync(cst)) {
      throw new Error(
        `vitest.config.ts: expected ${dialect}-parser CST source at ${cst}. `
        + 'If the file moved, update this alias — do not delete it, or workspace '
        + 'tests will silently resolve @jesscss/' + dialect + '-parser/cst to built lib.'
      );
    }
    alias.push({ find: new RegExp(`^@jesscss\\/${dialect}-parser\\/cst$`), replacement: cst });
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
    /*
     * experimental: {
     * viteModuleRunner: false,
     * },
     */
    watch: false,

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
