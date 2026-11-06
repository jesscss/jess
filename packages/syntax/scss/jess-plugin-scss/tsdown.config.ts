import { defineConfig } from 'tsdown';
import { createSingleEntryConfig } from '../../../../tools/tsdown/single-entry.mts';

const config = createSingleEntryConfig();
const { outputOptions } = config;

export default defineConfig({
  ...config,

  /*
   * `provided-modules` is its own entry, which loads no grammar; `index` shares
   * the one table it builds, so both entries resolve and trust the same files.
   */
  entry: ['./src/index.ts', './src/provided-modules.ts'],
  outputOptions(options, format, context) {
    const next = typeof outputOptions === 'function' ? outputOptions(options, format, context) : options;
    return { ...next, codeSplitting: true };
  }
});
