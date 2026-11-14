import { defineConfig } from 'tsdown';

/*
 * Public entries include the root, the cold-path diagnostic surface
 * (`./diagnostics`), the narrow value substrate (`./value`), the
 * evaluator a CSS-form built-in runs on (`./form`), a function called with
 * named arguments (`./call-named`), the dependency-free AST-v2 construction
 * surface (`./ast`), and source-map generation (`./sourcemap`), which the root
 * entry leaves out. Each source module is its own lib file (`unbundle`), so a
 * bundler drops every module a page does not use, with what it imports.
 */
export default defineConfig({
  entry: {
    index: './src/index.ts',
    diagnostics: './src/diagnostics.ts',
    value: './src/value.ts',
    form: './src/form.ts',
    // eslint-disable-next-line @typescript-eslint/naming-convention -- the published subpath
    'call-named': './src/call-named.ts',
    ast: './src/ast.ts',
    sourcemap: './src/sourcemap.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: './lib',
  platform: 'node',
  fixedExtension: false,
  hash: false,
  unbundle: true,
  deps: {
    onlyBundle: false
  },
  outputOptions(options, format) {
    if (format === 'cjs') {
      return {
        ...options,
        exports: 'named',

        /*
         * Rolldown's interop runtime gets its own chunk. Left to the default it
         * lands in `index`, so `serialize`/`form`/`sourcemap` require `index.cjs`
         * back: a cycle that leaves root exports undefined when a subpath entry
         * loads first. `verify:cjs-smoke` pins the load order.
         */
        codeSplitting: { groups: [{ name: 'runtime', test: /rolldown\/runtime/ }] }
      };
    }
    return options;
  }
});
