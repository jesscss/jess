import { defineConfig } from 'tsdown';

/*
 * Public entries include the root, the cold-path diagnostic surface
 * (`./diagnostics`), the narrow value substrate (`./value`), the
 * evaluator a CSS-form built-in runs on (`./form`), and the
 * dependency-free AST-v2 construction surface (`./ast`). Each source module is
 * its own lib file (`unbundle`), so a bundler drops every module a page does
 * not use, with what it imports (big.js reaches only the arithmetic).
 */
export default defineConfig({
  entry: {
    index: './src/index.ts',
    diagnostics: './src/diagnostics.ts',
    value: './src/value.ts',
    form: './src/form.ts',
    ast: './src/ast.ts'
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
    onlyBundle: false,

    /*
     * `color-name` is ESM-only. Left external, the CJS build `require`s it and
     * the bundler's node-mode interop hands the WHOLE module namespace to the
     * default import, so `namedColor('red')` answered `undefined` in every CJS
     * consumer — the trusted `#less`/`#sass/*` modules load through exactly that
     * build. Inlining the 148-entry table removes the interop step.
     */
    alwaysBundle: ['color-name']
  },
  outputOptions(options, format) {
    const extension = format === 'cjs' ? 'cjs' : 'js';
    return {
      ...options,
      ...(format === 'cjs' ? { exports: 'named' } : {}),

      /* npm never publishes a `node_modules` directory, so the bundled `color-name` goes to `lib/vendor/`. */
      entryFileNames: chunk => `${chunk.name.replace(/^node_modules\/(?:.*\/)?node_modules\//, 'vendor/')}.${extension}`
    };
  }
});
