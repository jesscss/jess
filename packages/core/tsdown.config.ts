import { defineConfig } from 'tsdown';
import { createSingleEntryConfig } from '../../tools/tsdown/single-entry.mts';

export default defineConfig([
  createSingleEntryConfig({
    format: 'esm',
    dts: true
  }),
  createSingleEntryConfig({
    format: 'cjs',
    dts: false,
    clean: false
  })
]);
