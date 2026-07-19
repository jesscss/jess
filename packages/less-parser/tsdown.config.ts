import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    ast: './src/direct-ast.ts',
    cst: './src/cst.ts',
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
    if (format === 'cjs') {
      return {
        ...options,
        exports: 'named'
      };
    }
    return options;
  }
});
