import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';

export default defineConfig({
  entry: { recognition: './src/recognition.ts', 'opaque-at-rule': './src/opaque-at-rule.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: './lib',
  platform: 'node',
  fixedExtension: false,
  hash: false,
  deps: { onlyBundle: false },
  plugins: [parseman.rolldown()],
  outputOptions(options, format) {
    return format === 'cjs' ? { ...options, exports: 'named' } : options;
  }
});
