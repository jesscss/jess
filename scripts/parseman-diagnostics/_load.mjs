/**
 * Shared loader for the parseman diagnostic scripts.
 *
 * Two load paths for the SAME grammar source, because the diagnostics need
 * different artifacts:
 *
 *  - `loadInterpreted()`  — vite WITHOUT `parseman.vite()`. The
 *    `import ... with { type: 'macro' }` degrades to a plain runtime import, so
 *    `rules()`/`composeLeaf()` execute and produce real `Combinator` objects.
 *    This is the "pre-compile map" the analysis surfaces require.
 *  - `loadMacro()`        — vite WITH `parseman.vite()` (optionally
 *    `{ grammarCoverage: true }`). Produces the fused artifact that actually
 *    ships: a map of plain compiled functions with no `_def` graph.
 *
 * Feeding the fused artifact to `analyzeGating*` is not a mistake to avoid here;
 * it is one of the things being measured (see `GatingReport.unanalysable`).
 */
import { createServer } from 'vite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const GRAMMARS = [
  { dialect: 'css', file: 'packages/syntax/css/css-parser/src/grammar.ts', exports: { ast: 'cssGrammar', cst: 'cssCstGrammar' } },
  { dialect: 'less', file: 'packages/syntax/less/less-parser/src/grammar.ts', exports: { ast: 'lessGrammar', cst: 'lessCstGrammar' } },
  { dialect: 'scss', file: 'packages/syntax/scss/scss-parser/src/grammar.ts', exports: { ast: 'scssGrammar', cst: 'scssCstGrammar' } },
  { dialect: 'jess', file: 'packages/syntax/jess/jess-parser/src/grammar.ts', exports: { ast: 'jessGrammar', cst: 'jessCstGrammar' } }
];

/** Mirror of the vitest config's workspace `src` aliases (see vitest.config.ts). */
function workspaceSrcAliases() {
  const alias = [];
  const walk = (rel) => {
    for (const d of readdirSync(resolve(ROOT, rel), { withFileTypes: true })) {
      if (!d.isDirectory()) {
        continue;
      }
      const dir = `${rel}/${d.name}`;
      const pj = resolve(ROOT, dir, 'package.json');
      const src = resolve(ROOT, dir, 'src/index.ts');
      if (existsSync(pj)) {
        if (existsSync(src)) {
          let name;
          try {
            name = JSON.parse(readFileSync(pj, 'utf8')).name;
          } catch {
            continue;
          }
          if (name) {
            alias.push({ find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: src });
          }
        }
      } else {
        walk(dir);
      }
    }
  };
  walk('packages');

  /*
   * parser-shared ships `lib/*` through its exports map. Left alone, the shared
   * recognition pieces arrive as ALREADY-macro-compiled artifacts, which is what
   * makes them opaque to the analysis. The macro plugin re-lowers them from
   * source at build time (see the css-parser `macro-compiled` test, which asserts
   * the transformed grammar contains no `@jesscss/parser-shared` reference), so
   * pointing at `src` is the faithful shape, not a cheat.
   */
  for (const sub of ['recognition', 'opaque-at-rule', 'pseudo-consts']) {
    alias.push({
      find: new RegExp(`^@jesscss/parser-shared/${sub.replace(/-/g, '\\-')}$`),
      replacement: resolve(ROOT, `packages/parser-shared/src/${sub}.ts`)
    });
  }
  alias.push({ find: /^@jesscss\/css-parser\/grammar$/, replacement: resolve(ROOT, 'packages/syntax/css/css-parser/src/grammar.ts') });
  alias.push({ find: /^@jesscss\/css-parser\/jess$/, replacement: resolve(ROOT, 'packages/syntax/css/css-parser/src/jess.ts') });
  return alias;
}

async function makeServer(plugins, ssr = {}) {
  return createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    plugins,
    ssr,
    resolve: { alias: workspaceSrcAliases(), mainFields: ['module', 'import', 'exports', 'main'] },
    server: { middlewareMode: true }
  });
}

/**
 * Redirect bare `parseman` to the runtime shim for everything EXCEPT the shim
 * itself (which must reach the real package). An alias entry cannot express
 * "unless the importer is X", hence a plugin.
 */
function parsemanShimPlugin() {
  const shim = resolve(ROOT, 'scripts/parseman-diagnostics/parseman-runtime-shim.mjs');
  return {
    name: 'jess-parseman-runtime-shim',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'parseman' && importer !== shim) {
        return shim;
      }
      return null;
    }
  };
}

export async function loadInterpreted() {
  /*
   * `parseman` lives in node_modules, so vite's SSR pipeline externalizes it and
   * loads it through plain node — which bypasses plugin `resolveId` entirely and
   * is why the shim silently did nothing until `noExternal` pulled it back in.
   */
  const server = await makeServer([parsemanShimPlugin()], { noExternal: ['parseman'] });
  return {
    load: file => server.ssrLoadModule('/' + file),
    transform: file => server.transformRequest('/' + file),
    close: () => server.close()
  };
}

export async function loadMacro(options = {}) {
  const parseman = (await import('parseman/plugin')).default;
  const server = await makeServer([parseman.vite(options)]);
  return {
    load: file => server.ssrLoadModule('/' + file),
    transform: file => server.transformRequest('/' + file),
    close: () => server.close()
  };
}
