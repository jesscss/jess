import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { grammarVariantBuilds, parserEntryBuild } from '../../../../tools/tsdown/grammar-variants.mts';

/*
 * Keep the compose base and its provenance sources EXTERNAL in every emitted
 * artifact instead of inlining them as locals. `cssBaseRules` (from
 * `@jesscss/css-parser/grammar/base`) carries css's recognition + reducer rules by
 * spreading `@jesscss/parser-shared` recognition and `@jesscss/core/ast`
 * helpers via its runtime `parseman.composedPieces` — and the downstream
 * compose analyzer can only follow that spread statically when those grammars
 * stay resolvable imports. Bundled as locals the spread is unfollowable and a
 * cross-package `compose([cssBaseRules, delta])` silently drops the inherited
 * rules, leaving a runtime `compose()` that throws. (Mirrors css-parser's
 * PARSER_SHARED_EXTERNAL and less-parser's COMPOSE_EXTERNAL.)
 */
const COMPOSE_EXTERNAL = [
  /^@jesscss\/css-parser(\/|$)/,
  /^@jesscss\/parser-shared(\/|$)/,
  /^@jesscss\/core(\/|$)/
];

/*
 * Selective assembly: generated code for the sites the static ranking calls
 * hottest. That ranking moves with any change to the grammar's rule graph, so the
 * default budget (0.25 of the source length) left the ordinary path running through
 * the table once control bodies became the one nested body: +3% marginal
 * instructions on `gen-workload` with no control block in it. Measured: 0.33 +2.8%,
 * 0.36 +1.2%, 0.4 +0.6%, for 8.8% more bytes (4.8% gzipped) and +0.5% import.
 */
const ASSEMBLY = { assemblyBudget: 0.4 };

export default defineConfig([
  parserEntryBuild({
    entry: {
      index: './src/index.ts',
      cst: './src/cst.ts',
      positions: './src/positions.ts',
      'cst/positions': './src/cst/positions.ts'
    },
    external: COMPOSE_EXTERNAL,
    plugins: [parseman.rolldown(ASSEMBLY)]
  }),
  ...grammarVariantBuilds({ external: COMPOSE_EXTERNAL, plugins: [parseman.rolldown(ASSEMBLY)] })
]);
