import baseConfig from '../../_shared/eslint.config.mjs';

import tseslint from 'typescript-eslint';

export default tseslint.config([
  ...baseConfig,
  {
    ignores: ['lib/**', '*.config.*']
  },
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
  }
]);
