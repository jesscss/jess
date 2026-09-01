import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { grammarVariantBuilds, parserEntryBuild } from '../../../../tools/tsdown/grammar-variants.mts';

/** Emitted as `lib/cst-host.js`; a computed key keeps the kebab-case name. */
const CST_HOST = 'cst-host';

/*
 * Keep `@jesscss/parser-shared` (the recognition base: `cssSyntax`, the unknown
 * at-rule recognizer, the pseudo consts) an EXTERNAL import in every emitted
 * artifact instead of inlining it as a local. The compose base `cssBaseRules`
 * carries its recognition rules by spreading those grammars' runtime
 * `parseman.composedPieces` — and the downstream compose analyzer can only
 * follow that spread statically when the grammar is an import it can resolve to
 * its own module. Bundled as a local const (the default, since parser-shared was
 * a dev-only dependency), the spread is unfollowable and a cross-package
 * `compose([cssBaseRules, delta])` silently drops all ~69 recognition rules,
 * leaving a runtime `compose()` that throws. Externalizing it is what makes the
 * base composable across a package boundary.
 */
const PARSER_SHARED_EXTERNAL = [/^@jesscss\/parser-shared(\/|$)/];

export default defineConfig([
  parserEntryBuild({
    /*
     * `cst-host` is its own entry, not just a module the `cst` entry pulls in.
     * As a plain dependency rolldown merges it into the `cst` chunk, and that
     * chunk statically imports the two compiled CST grammar tables — so every
     * dialect package, which needs only the runner from the host, would load
     * the CSS tables it never uses.
     */
    entry: {
      index: './src/index.ts',
      cst: './src/cst.ts',
      positions: './src/positions.ts',
      'cst/positions': './src/cst/positions.ts',
      [CST_HOST]: './src/cst-host.ts'
    },
    external: PARSER_SHARED_EXTERNAL,
    plugins: [parseman.rolldown()]
  }),
  ...grammarVariantBuilds({ external: PARSER_SHARED_EXTERNAL, plugins: [parseman.rolldown()] })
]);
