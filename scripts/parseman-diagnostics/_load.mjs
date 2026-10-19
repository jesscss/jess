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
import { workspaceSrcAliases } from '../workspace-src-aliases.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const GRAMMARS = [
  { dialect: 'css', file: 'packages/syntax/css/css-parser/src/grammar.ts', exports: { ast: 'cssGrammar', cst: 'cssCstGrammar' } },
  { dialect: 'less', file: 'packages/syntax/less/less-parser/src/grammar.ts', exports: { ast: 'lessGrammar', cst: 'lessCstGrammar' } },
  { dialect: 'scss', file: 'packages/syntax/scss/scss-parser/src/grammar.ts', exports: { ast: 'scssGrammar', cst: 'scssCstGrammar' } },
  { dialect: 'jess', file: 'packages/syntax/jess/jess-parser/src/grammar.ts', exports: { ast: 'jessGrammar', cst: 'jessCstGrammar' } }
];

/*
 * The same source aliases as the vitest config. They matter most for
 * `@jesscss/parser-shared/*`: its `lib` ships the recognition pieces already
 * macro-compiled, which makes them opaque to the analysis, so the interpreted
 * load must reach the source.
 */
async function makeServer(plugins, ssr = {}) {
  return createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    plugins,
    ssr,
    resolve: { alias: workspaceSrcAliases(ROOT), mainFields: ['module', 'import', 'exports', 'main'] },
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
