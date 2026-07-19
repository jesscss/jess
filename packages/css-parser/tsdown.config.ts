import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';

// The parseman macro plugin compiles grammars that import `with { type: 'macro' }`
// to optimized JS at build time. No-op for sources without the macro attribute.
export default defineConfig({
  entry: {
    index: './src/index.ts',
    cst: './src/cst-css.ts',
    ast: './src/direct-ast.ts',
    grammar: './src/grammar.ts',
    jess: './src/jess.ts'
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
