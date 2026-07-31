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
      positions: './src/positions.ts',
      'cst/positions': './src/cst/positions.ts',
      [CST_HOST]: './src/cst-host.ts'
    },
    /*
     * `parse-with` must be a real top-level entry, not a shared chunk. As a
     * chunk it emits at `lib/chunks/parse-with.js` with rolldown-mangled
     * exports (`n`, `t`) and no `parseWith` binding, while `lib/parse-with.d.ts`
     * still exists — so a directory listing looks correct and an importer of
     * `lib/parse-with.js` fails. `less-parser/tsdown.config.ts:21` already uses
     * `shared` for exactly this reason.
     */
    shared: ['parse-with'],
    plugins: [parseman.rolldown()]
  }),
  ...grammarVariantBuilds({ shared: ['parse-with'], plugins: [parseman.rolldown()] })
]);
