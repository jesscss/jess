import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { grammarVariantBuilds, parserEntryBuild } from '../../../../tools/tsdown/grammar-variants.mts';

/** Emitted as `lib/cst-host.js`; a computed key keeps the kebab-case name. */
const CST_HOST = 'cst-host';

export default defineConfig([
  parserEntryBuild({
    /*
     * `cst-host` is its own entry, not just a module the `cst` entry pulls in.
     * As a plain dependency rolldown merges it into the `cst` chunk, and that
     * chunk statically imports the two compiled CST grammar tables — so every
     * dialect package, which needs only the runner from the host, would load
     * the CSS tables it never uses.
     */
    entry: {
      index: './src/index.ts',
      cst: './src/cst.ts',
      [CST_HOST]: './src/cst-host.ts'
    },
    plugins: [parseman.rolldown()]
  }),
  ...grammarVariantBuilds({ plugins: [parseman.rolldown()] })
]);
