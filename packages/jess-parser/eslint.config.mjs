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
      'src/productions.ts',
      'src/productions/atRules.ts',
      'src/productions/controlFlow.ts',
      'src/productions/mixins.ts',
      'src/productions/root.ts',
      'src/productions/values.ts',
      'src/jessTokens.ts',
      'src/jessRecursiveParser.ts',
      'src/jessParser.ts',
      'src/jessActionsParser.ts'
    ],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off'
    }
  }
]);
