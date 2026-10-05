import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import circleDependency from 'vite-plugin-circular-dependency';
import parseman from 'parseman/plugin';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve workspace packages to their source FOR VITEST ONLY, via exact-match
 * aliases. Vitest is TS-aware (rewrites `.js`→`.ts`), so tests run against
 * current source with no lib rebuild and no stale-lib phantom failures.
 *
 * We deliberately do NOT use a `"source"` export condition for this: that
 * condition leaks to every resolver, including non-TS-aware loaders (the
 * `styles-config` config loader, native `require`), which then choke on core's
 * `.js` import specifiers (`Cannot find module core/src/tree/index.js`). An
 * alias is vitest-scoped, so those loaders keep resolving to built `lib`.
 * Exact-match (`^name$`), one alias per bare name and per subpath export.
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
  const exact = (specifier: string, replacement: string) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    replacement
  });

  /*
   * Kept on the css grammar module itself, as before subpaths were derived:
   * `src/grammar/base.ts` is only the re-export shell that gives the compose base
   * its own lib entry. It comes first because the first matching alias wins.
   */
  const alias: { find: RegExp; replacement: string }[] = [
    exact('@jesscss/css-parser/grammar/base', resolve(root, 'packages/syntax/css/css-parser/src/grammar.ts'))
  ];

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
      let pkg: { name?: string; exports?: Record<string, string | { import?: string }> };
      try {
        pkg = JSON.parse(readFileSync(pj, 'utf8'));
      } catch {
        return;
      }
      const name = pkg.name;
      if (!name) {
        return;
      }
      alias.push(exact(name, src));

      /*
       * Every subpath export, too (`@jesscss/core/ast`, `@jesscss/fns/sass/registry`,
       * `@jesscss/less-parser/cst`, …), aliased to the source module its `lib`
       * file is built from. Left on node resolution, a subpath lands on built
       * `lib` while the bare name above lands on `src`: a HALF-source graph, in
       * which a source-side consumer runs a stale lib module (and its lib copy of
       * `@jesscss/core`, so `instanceof` across the boundary is false). Derived
       * from `exports`, not listed, so a new subpath cannot be forgotten.
       *
       * The parsers' `grammar/interpreter/*` exports are the one twinless kind:
       * the interpreter build of `src/grammar/<variant>.ts`, with no source file
       * of their own, so they stay on lib. Any other export without a source twin
       * THROWS rather than silently falling back to lib.
       */
      for (const [key, target] of Object.entries(pkg.exports ?? {})) {
        const file = /^\.\/lib\/(.+)\.js$/.exec((typeof target === 'string' ? target : target.import) ?? '')?.[1];
        if (key === '.' || file === undefined || file.startsWith('grammar/interpreter/')) {
          continue;
        }
        const source = resolve(dir, 'src', `${file}.ts`);
        if (!existsSync(source)) {
          throw new Error(
            `vitest.config.ts: ${name}${key.slice(1)} exports lib/${file}.js but ${source} does not exist. `
            + 'Point the export at its source module, or tests silently resolve it to built lib.'
          );
        }
        alias.push(exact(`${name}${key.slice(1)}`, source));
      }
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

    /*
     * Circular-import detection is a CI/pre-push guardrail, not a per-run need:
     * it only warns (no failing gate) yet runs on every module transform. Gate it
     * behind an env flag so local/watch test runs skip the transform overhead.
     */
    ...(process.env.VITEST_CIRCULAR === 'true' ? [circleDependency()] : [])
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
