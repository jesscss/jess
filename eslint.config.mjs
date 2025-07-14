import {
  globalIgnores
} from 'eslint/config';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import {
  FlatCompat
} from '@eslint/eslintrc';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

const customized = stylistic.configs.customize({
  indent: 2,
  quotes: 'single',
  semi: true,
  jsx: true,
  braceStyle: '1tbs'
});

const jsRules = {
  semi: 0,
  ...customized.rules,

  '@stylistic/space-before-function-paren': ['error', {
    anonymous: 'never',
    named: 'never',
    asyncArrow: 'always'
  }],

  '@stylistic/quote-props': ['error', 'as-needed'],

  camelcase: ['warn', {
    ignoreDestructuring: true,
    properties: 'never'
  }],

  '@stylistic/no-multi-spaces': 0,

  '@stylistic/operator-linebreak': ['error', 'before', {
    overrides: {
      '=': 'after'
    }
  }],

  '@stylistic/eol-last': 0,
  'no-return-assign': 0,
  '@stylistic/function-call-spacing': 'error',
  '@stylistic/comma-dangle': ['error', 'never'],
  '@stylistic/padded-blocks': ['error', 'never']
};

export default tseslint.config([
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    plugins: {
      '@stylistic': stylistic,
      '@typescript-eslint': tseslint.plugin
    }
  }, {
    files: ['**/*.js', '**/*.mjs'],

    rules: {
      ...jsRules,
      'prefer-const': 0
    }
  }, {
    files: ['**/*.ts', '**/*.tsx'],

    plugins: {
      '@stylistic': stylistic,
      '@typescript-eslint': tseslint.plugin
    },

    extends: compat.extends(),

    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },

    rules: {
      ...jsRules,
      'eol-last': 0,
      'prefer-const': 0,
      '@typescript-eslint/no-confusing-void-expression': 'off',
      'no-void': 0,
      '@typescript-eslint/consistent-type-assertions': 0,

      '@typescript-eslint/no-floating-promises': ['warn', {
        ignoreVoid: true
      }],

      '@typescript-eslint/strict-boolean-expressions': 0,
      '@typescript-eslint/restrict-template-expressions': 0,
      '@typescript-eslint/method-signature-style': 0,
      '@typescript-eslint/explicit-function-return-type': 0,
      '@typescript-eslint/no-non-null-assertion': 0,
      '@typescript-eslint/consistent-type-definitions': 0,
      '@typescript-eslint/no-this-alias': 0,

      '@typescript-eslint/naming-convention': ['error', {
        selector: 'default',
        format: ['camelCase', 'PascalCase', 'UPPER_CASE', 'snake_case'],
        leadingUnderscore: 'allow'
      }, {
        selector: 'variableLike',
        format: ['camelCase', 'UPPER_CASE', 'PascalCase', 'snake_case']
      }, {
        selector: 'memberLike',
        format: ['camelCase', 'PascalCase', 'UPPER_CASE', 'snake_case'],
        leadingUnderscore: 'allow'
      }, {
        selector: 'memberLike',
        modifiers: ['private'],
        leadingUnderscore: 'allowSingleOrDouble',
        format: ['camelCase', 'UPPER_CASE']
      }, {
        selector: 'memberLike',
        modifiers: ['protected'],
        leadingUnderscore: 'allow',
        format: ['camelCase', 'UPPER_CASE']
      }, {
        selector: 'typeLike',
        format: ['PascalCase', 'UPPER_CASE', 'snake_case']
      }, {
        selector: 'property',
        format: ['camelCase', 'PascalCase', 'snake_case'],
        leadingUnderscore: 'allow'
      }]
    }
  }, {
    files: ['**/test/**/*.{js,ts}', '**/__tests__/*.{js,ts}', '**/*.test.{js,ts}'],

    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },

    plugins: {
      '@typescript-eslint': tseslint.plugin
    },

    rules: {
      '@typescript-eslint/no-unused-vars': 0
    }
  }, globalIgnores(['**/node_modules', '**/lib', '**/dist', 'packages/**'])
]);
