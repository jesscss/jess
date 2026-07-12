import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config([
  ...rootConfig,
  {
    files: ['*.ts', '*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'error'
    }
  },
  {
    files: ['src/index.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off'
    }
  }
]);
