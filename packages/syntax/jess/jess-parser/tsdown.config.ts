import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { grammarVariantBuilds, parserEntryBuild } from '../../../../tools/tsdown/grammar-variants.mts';

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
 * PARSER_SHARED_EXTERNAL and less/scss-parser's COMPOSE_EXTERNAL.)
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
    external: COMPOSE_EXTERNAL,
    plugins: [parseman.rolldown()]
  }),
  ...grammarVariantBuilds({ external: COMPOSE_EXTERNAL, plugins: [parseman.rolldown()] })
]);
