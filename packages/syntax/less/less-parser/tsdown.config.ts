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

export default defineConfig([
  parserEntryBuild({
    entry: {
      index: './src/index.ts',
      cst: './src/cst.ts'
    },
    shared: SHARED,
    plugins: [parseman.rolldown()]
  }),
  ...grammarVariantBuilds({ shared: SHARED, plugins: [parseman.rolldown()] })
]);
