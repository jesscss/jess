import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'runtime-worker': './src/runtime-worker.ts'
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
