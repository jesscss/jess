import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { grammarVariantBuilds, parserEntryBuild } from '../../../../tools/tsdown/grammar-variants.mts';

export default defineConfig([
  parserEntryBuild({
    entry: {
      index: './src/index.ts',
      cst: './src/cst.ts'
    },
    plugins: [parseman.rolldown()]
  }),
  ...grammarVariantBuilds({ plugins: [parseman.rolldown()] })
]);
