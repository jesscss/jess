import { defineConfig } from 'tsdown';
import { createSingleEntryConfig } from '../../tools/tsdown/single-entry.mts';

const config = createSingleEntryConfig();
const { outputOptions } = config;

export default defineConfig({
  ...config,

  /*
   * The CommonJS build loads the lazily imported dialect plugins with require(),
   * so it gets their CommonJS builds and the CommonJS @jesscss/core they share.
   */
  outputOptions(options, format, context) {
    const next = typeof outputOptions === 'function' ? outputOptions(options, format, context) : options;
    return format === 'cjs' ? { ...next, dynamicImportInCjs: false } : next;
  }
});
