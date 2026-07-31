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
