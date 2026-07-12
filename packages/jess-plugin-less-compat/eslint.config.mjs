import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config([
  ...rootConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'error'
    }
  },
  {
    // Proxy symbol access, visitor patterns, dynamic plugin interop
    files: [
      'src/plugin.ts',
      'src/transform/proxy.ts',
      'src/transform/adapter.ts',
      'src/transform/from-less.ts',
      'src/transform/to-less.ts'
    ],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off'
    }
  }
]);
