import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';

export default defineConfig({
  entry: {
    recognition: './src/recognition.ts',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'unknown-at-rule': './src/unknown-at-rule.ts',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'pseudo-consts': './src/pseudo-consts.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,

  /*
   * Rebuilt in place, never emptied first. Every dialect parser's `build`
   * rebuilds this package before compiling, and in the graph-parallel CI build
   * less, scss and jess do so at the same time. Emptying lib/ there let a
   * sibling's macro find `@jesscss/parser-shared/recognition` missing while it
   * loaded the css base grammar, and its compose() fell back to the
   * interpreter. Clean builds (CI, `verify:pr`) already delete every lib/
   * before they start.
   */
  clean: false,
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
