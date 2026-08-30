import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    config: './src/config.ts',
    diagnostics: './src/diagnostics.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: './lib',
  platform: 'node',
  fixedExtension: false,
  hash: false,
  deps: {
    alwaysBundle: ['linecraft'],
    onlyBundle: ['linecraft']
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
