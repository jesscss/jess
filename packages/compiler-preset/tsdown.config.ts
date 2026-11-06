import { defineConfig } from 'tsdown';
import { createSingleEntryConfig } from '../../tools/tsdown/single-entry.mts';

const config = createSingleEntryConfig();
const { outputOptions } = config;

export default defineConfig({
  ...config,

  /* `css` is its own entry, imported by `index` only when a `.css` document is parsed. */
  entry: { index: './src/index.ts', css: './src/css.ts' },

  /*
   * The CommonJS build loads the lazily imported plugins with require(), so it
   * gets their CommonJS builds and the CommonJS @jesscss/core they share.
   */
  outputOptions(options, format, context) {
    const next = typeof outputOptions === 'function' ? outputOptions(options, format, context) : options;
    return format === 'cjs' ? { ...next, codeSplitting: true, dynamicImportInCjs: false } : { ...next, codeSplitting: true };
  }
});
