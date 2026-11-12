import { defineConfig } from 'tsdown';

/*
 * Public entries include the root, the cold-path diagnostic surface
 * (`./diagnostics`), the narrow value substrate (`./value`), the
 * evaluator a CSS-form built-in runs on (`./form`), a function called with
 * named arguments (`./call-named`), and the
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
    // eslint-disable-next-line @typescript-eslint/naming-convention -- the published subpath
    'call-named': './src/call-named.ts',
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
    onlyBundle: false
  },
  outputOptions(options, format) {
    if (format === 'cjs') {
      return {
        ...options,
        exports: 'named'
      };
    }
    return options;
  }
});
