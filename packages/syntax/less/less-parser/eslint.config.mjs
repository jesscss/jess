import rootConfig, { grammarSourcePlugins, grammarSourceRules } from '../../../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config([
  {
    ignores: ['coverage/**']
  },
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
    ignores: ['**/__tests__/**', '**/*.test.ts'],
    plugins: grammarSourcePlugins,
    rules: {
      ...grammarSourceRules,

      /*
       * Mirrored from the root Less override: this parser is still in a heavy
       * grammar-shaping pass, so keep parser-correctness rules on while
       * deferring comment and non-ASCII cleanup to that pass.
       */
      'grammar/no-line-comments': 'off',
      '@stylistic/lines-around-comment': 'off',
      'grammar/no-literal-non-ascii-in-regex': 'off'
    }
  },
  {
    rules: {
      'no-return-assign': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'error'
    }
  }
]);
