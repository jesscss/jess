import { defineConfig } from 'tsdown';
import { createSingleEntryConfig } from '../../tools/tsdown/single-entry.mts';

export default defineConfig([
  createSingleEntryConfig(),
  createSingleEntryConfig({
    entry: './src/tree/util/raw-selector.ts',
    outDir: './lib/internal',
    clean: false
  })
]);
