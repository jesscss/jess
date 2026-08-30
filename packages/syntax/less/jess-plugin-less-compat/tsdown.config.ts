import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: './src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: './lib',
  platform: 'node',
  fixedExtension: false,
  hash: false,
  deps: {
    onlyBundle: false
  }
});
