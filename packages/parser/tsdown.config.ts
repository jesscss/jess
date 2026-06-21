import { defineConfig } from 'tsdown';
import { createSingleEntryConfig } from '../../tools/tsdown/single-entry.mts';

export default defineConfig([
  createSingleEntryConfig(),
  createSingleEntryConfig({
    entry: './src/services/index.ts',
    outDir: './lib/services',
    clean: false
  }),
  createSingleEntryConfig({
    entry: './src/structure/index.ts',
    outDir: './lib/structure',
    clean: false
  })
]);
