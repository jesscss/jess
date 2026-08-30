import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { grammarVariantBuilds, parserEntryBuild } from '../../../../tools/tsdown/grammar-variants.mts';

export default defineConfig([
  parserEntryBuild({
    entry: {
      index: './src/index.ts',
      cst: './src/cst.ts',
      positions: './src/positions.ts',
      'cst/positions': './src/cst/positions.ts'
    },
    plugins: [parseman.rolldown()]
  }),
  ...grammarVariantBuilds({ plugins: [parseman.rolldown()] })
]);
