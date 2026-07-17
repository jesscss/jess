import { defineConfig } from 'tsdown';

// Two entries: the package root (`.`) and the narrow value-substrate surface
// (`./value`) consumed by `@jesscss/fns`. Code splitting is left ON (unlike the
// shared single-entry helper) so the value substrate lands in a shared chunk —
// one runtime instance, no byte duplication across `index` and `value`.
export default defineConfig({
  entry: {
    index: './src/index.ts',
    value: './src/value.ts'
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
