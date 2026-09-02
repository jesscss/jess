import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { grammarVariantBuilds, parserEntryBuild } from '../../../../tools/tsdown/grammar-variants.mts';

/*
 * `parse-error` is reached from both the public entries and the grammar
 * reductions, so it is emitted once and shared: bundling a copy into each
 * variant would give the error classes two identities and break `instanceof`
 * for callers that catch them.
 */
const SHARED = ['parse-error'];

/*
 * Keep the compose base and its provenance sources EXTERNAL in every emitted
 * artifact instead of inlining them as locals. `cssBaseRules` (from
 * `@jesscss/css-parser/grammar`) carries css's recognition + reducer rules by
 * spreading `@jesscss/parser-shared` recognition and `@jesscss/core/ast`
 * helpers via its runtime `parseman.composedPieces` — and the downstream
 * compose analyzer can only follow that spread statically when those grammars
 * stay resolvable imports. Bundled as locals the spread is unfollowable and a
 * cross-package `compose([cssBaseRules, delta])` silently drops the inherited
 * rules, leaving a runtime `compose()` that throws. (Mirrors css-parser's
 * PARSER_SHARED_EXTERNAL.)
 */
const COMPOSE_EXTERNAL = [
  /^@jesscss\/css-parser(\/|$)/,
  /^@jesscss\/parser-shared(\/|$)/,
  /^@jesscss\/core(\/|$)/
];

export default defineConfig([
  parserEntryBuild({
    entry: {
      index: './src/index.ts',
      cst: './src/cst.ts',
      positions: './src/positions.ts',
      'cst/positions': './src/cst/positions.ts'
    },
    shared: SHARED,
    external: COMPOSE_EXTERNAL,
    plugins: [parseman.rolldown()]
  }),
  ...grammarVariantBuilds({ shared: SHARED, external: COMPOSE_EXTERNAL, plugins: [parseman.rolldown()] })
]);
