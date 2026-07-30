import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { nestSharedChunks } from '../../../../tools/tsdown/chunk-names.mts';

/*
 * The parseman macro plugin compiles grammars that import `with { type: 'macro' }`
 * to optimized JS at build time. No-op for sources without the macro attribute.
 */
export default defineConfig({
  entry: {
    index: './src/index.ts',
    cst: './src/cst-css.ts',
    grammar: './src/grammar.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: './lib',
  platform: 'node',
  fixedExtension: false,
  hash: false,
  deps: {
    onlyBundle: false
  },
  plugins: [parseman.rolldown()],
  outputOptions(options, format) {
    const nextOptions = {
      ...options,
      chunkFileNames: nestSharedChunks(options.chunkFileNames)
    };

    if (format === 'cjs') {
      return {
        ...nextOptions,
        exports: 'named'
      };
    }
    return nextOptions;
  }
});
