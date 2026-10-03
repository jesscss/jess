import { defineConfig } from 'tsdown';

/*
 * Public entries include the root, the cold-path diagnostic surface
 * (`./diagnostics`), the narrow value substrate (`./value`), and the
 * dependency-free AST-v2 construction surface (`./ast`). Code splitting is left
 * ON so shared runtime code is emitted once.
 */
export default defineConfig({
  entry: {
    index: './src/index.ts',
    diagnostics: './src/diagnostics.ts',
    value: './src/value.ts',
    ast: './src/ast.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: './lib',
  platform: 'node',
  fixedExtension: false,
  hash: false,
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
    if (format === 'cjs') {
      return {
        ...options,
        exports: 'named'
      };
    }
    return options;
  }
});
