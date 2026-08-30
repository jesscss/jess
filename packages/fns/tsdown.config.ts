import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    registry: './src/registry.ts',
    'less/index': './src/less/index.ts',
    'less/registry': './src/less/registry.ts',
    'sass/index': './src/sass/index.ts',
    'sass/registry': './src/sass/registry.ts',
    'sass/color/index': './src/sass/color/index.ts',
    'sass/list/index': './src/sass/list/index.ts',
    'sass/map/index': './src/sass/map/index.ts',
    'sass/math/index': './src/sass/math/index.ts',
    'sass/string/index': './src/sass/string/index.ts',
    'shared/index': './src/shared/index.ts'
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
