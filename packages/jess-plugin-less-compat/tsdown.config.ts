import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'transform/index': './src/transform/index.ts',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'less-compat-structures': './src/less-compat-structures.ts'
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
  }
});
