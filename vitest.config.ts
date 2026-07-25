import { defineConfig, defaultExclude } from 'vitest/config';
import { resolve, dirname } from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import circleDependency from 'vite-plugin-circular-dependency';
import parseman from 'parseman/plugin';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Baseline `exclude` for every project in this repo.
 *
 * Vitest REPLACES its default exclude when a config supplies one — it does not
 * merge. Dropping `**\/node_modules/**` is catastrophic in a pnpm workspace:
 * every workspace package is symlinked into its dependents' `node_modules`, so
 * a `**`-anchored include walks those symlink chains recursively and collects
 * the same suites over and over (plus third-party packages' own test files).
 * Any project that sets `exclude` MUST spread this first.
 */
export const sharedExclude = [
  ...defaultExclude,
  '**/lib/**',
  '**/dist/**',
  '**/*bench*'
];

/**
 * THIS FILE IS LOADED BY BOTH TEST LANES. Most packages have no vitest config of
 * their own, so `pnpm --filter <pkg> test` (i.e. `pnpm run -r ci`) runs `vitest`
 * from the package directory and vitest walks UP to this file. `projects` must
 * therefore mean different things depending on where vitest was invoked:
 *
 *  - from the workspace root: one project per package, plus the `root` project.
 *  - from inside a package: NO projects at all, so this config *is* the single
 *    project, rooted at that package. Declaring projects there would either
 *    resolve the paths against the package directory (a hard startup error) or
 *    make one package's `pnpm test` run the entire monorepo.
 *
 * That second case used to happen by accident: `projects: ['packages/*']`
 * silently matched nothing from inside a package, leaving only the anonymous
 * root project, which carried the aliases/globals/setupFiles that made suites
 * pass. The root lane got a different project set for the same files — the
 * divergence this split makes explicit.
 */
const invokedFromPackage = (() => {
  const cwd = process.cwd();
  const packagesDir = resolve(root, 'packages');
  return cwd !== root && (cwd === packagesDir || cwd.startsWith(packagesDir + '/'));
})();

/**
 * One vitest project per workspace package.
 *
 * A bare `'packages/*'` glob is NOT equivalent: for a package directory with no
 * config file of its own, vitest builds the project from its OWN defaults and
 * inherits nothing from this file — no `globals`, no `setupFiles`, and crucially
 * none of the `resolve.alias` entries that point workspace imports at `src`.
 * That is why the root lane reported `describe is not defined` and
 * `Cannot find package '@jesscss/fns'` for suites that pass per-package.
 *
 * So: packages that DO have a `vitest.config.ts` are referenced by ABSOLUTE path
 * (their own config applies, including deliberate overrides such as
 * less-parser's `exclude` and vscode's empty `include`); every other package
 * gets an inline project with `extends: true`, which is what actually pulls in
 * the root plugins, aliases and test options.
 */
function workspaceProjects() {
  const projects: (string | { extends: true; test: { name: string; root: string } })[] = [];
  for (const d of readdirSync(resolve(root, 'packages')).sort()) {
    const dir = resolve(root, 'packages', d);
    const pj = resolve(dir, 'package.json');
    if (!existsSync(pj)) {
      continue;
    }
    if (['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'].some(f => existsSync(resolve(dir, f)))) {
      projects.push(dir);
      continue;
    }
    let name: string | undefined;
    try {
      name = JSON.parse(readFileSync(pj, 'utf8')).name;
    } catch {
      continue;
    }
    projects.push({ extends: true, test: { name: name ?? d, root: dir } });
  }
  return projects;
}

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
    if (!existsSync(pj) || !existsSync(src)) {
      continue;
    }
    let name: string | undefined;
    try {
      name = JSON.parse(readFileSync(pj, 'utf8')).name;
    } catch {
      continue;
    }
    if (!name) {
      continue;
    }
    alias.push({ find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: src });
  }
  // CSS-parser subpaths used by source-aliased workspace parsers. Subpaths
  // normally fall through to node resolution, which misses from a consuming
  // package when the direct parser package itself has been aliased to `src`.
  // These aliases preserve the same source-to-source graph that the built
  // package exports provide to production consumers.
  const cssJess = resolve(root, 'packages/css-parser/src/jess.ts');
  if (existsSync(cssJess)) {
    alias.push({ find: /^@jesscss\/css-parser\/jess$/, replacement: cssJess });
  }
  const cssGrammar = resolve(root, 'packages/css-parser/src/grammar.ts');
  if (existsSync(cssGrammar)) {
    alias.push({ find: /^@jesscss\/css-parser\/grammar$/, replacement: cssGrammar });
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
    // Inherited by every `extends: true` project. See `sharedExclude`.
    exclude: sharedExclude,
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
      process[type === 'stderr' ? 'stderr' : 'stdout'].write(log + '\n');
      return false;
    },
    testTimeout: 30_000,
    reporters: [['tree', { summary: true }]],
    // Enable globals for describe, test, etc.
    globals: true,
    // Only the ROOT invocation fans out into projects; from inside a package
    // this config is the single project, rooted at that package. See
    // `invokedFromPackage`.
    ...(invokedFromPackage
      ? {}
      : {
          projects: [
            // Each workspace package is its own project, rooted at the package
            // directory. Package suites — including `src/**\/__tests__/**` —
            // belong HERE, and only here.
            ...workspaceProjects(),
            {
              extends: true,
              test: {
                name: 'root',
                /**
                 * The root project owns ONLY the workspace-root `test/`
                 * directory (currently `test/ast-shape/`). It deliberately does
                 * NOT glob `**\/__tests__/**`: those patterns resolve from the
                 * repo root, so they re-collected every package's suite a second
                 * time under root-relative settings, and — because the old
                 * `exclude` listed a bare `node_modules/**`, which matches only
                 * the TOP-LEVEL directory — they also descended into
                 * `packages/*\/node_modules`, where pnpm's workspace symlinks
                 * made collection explode (17.8k files, 17.5k of them inside
                 * node_modules, including third-party packages' own suites).
                 * That is what made root `pnpm test` diverge from `pnpm -r ci`.
                 */
                include: ['test/**/*.{test,spec}.ts'],
                exclude: [...sharedExclude, 'test/setup.ts']
              }
            }
          ]
        }),

    // Global setup file - use absolute path so it works from any subfolder
    setupFiles: [resolve(__dirname, './test/setup.ts')],
    // Disable coverage by default to save memory
    coverage: {
      enabled: false,
      provider: 'v8'
    }
  }
});
