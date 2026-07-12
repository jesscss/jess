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
    files: [
      'src/cssParser.ts',
      'src/cssRecursiveParser.ts',
      'src/productions/atRules.ts',
      'src/productions/misc.ts',
      'src/productions/selectors.ts',
      'src/productions/values.ts',
      'src/util/index.ts'
    ],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'warn'
    }
  }
]);
