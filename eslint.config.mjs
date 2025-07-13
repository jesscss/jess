import {
  globalIgnores
} from 'eslint/config';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import love from 'eslint-config-love';
import {
  FlatCompat
} from '@eslint/eslintrc';

import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const standard = JSON.parse(readFileSync(require.resolve('eslint-config-standard/.eslintrc.json'), 'utf-8'));

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

const customized = stylistic.configs.customize({
  indent: 2,
  quotes: 'single',
  semi: true,
  jsx: true
});

let commonRules = {};

/** Replicate StandardJS using Stylistic */
Object.entries(standard.rules).forEach(([key, value]) => {
  if (stylistic.rules[key]) {
    commonRules[`@stylistic/${key}`] = value;
  }
});

const jsRules = {
  semi: 0,
  ...commonRules,
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
  '@stylistic/comma-dangle': ['error', 'never']
};

export default tseslint.config([{
  languageOptions: {
    globals: {
      ...globals.node,
      ...globals.browser
    }
  },
  ...love,
  plugins: {
    '@stylistic': stylistic,
    '@typescript-eslint': tseslint.plugin
  }
}, {
  ...love,
  files: ['**/*.js', '**/*.mjs'],

  rules: {
    ...jsRules,
    'prefer-const': 0
  }
}, {
  ...love,
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
      tsconfigRootDir: import.meta.dirname,
    },
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
      format: ['camelCase']
    }, {
      selector: 'variable',
      format: ['camelCase', 'UPPER_CASE', 'PascalCase']
    }, {
      selector: 'variable',
      modifiers: ['destructured'],
      format: null
    }, {
      selector: 'memberLike',
      format: ['camelCase', 'PascalCase']
    }, {
      selector: 'memberLike',
      modifiers: ['private'],
      leadingUnderscore: 'allowSingleOrDouble',
      format: ['camelCase']
    }, {
      selector: 'memberLike',
      modifiers: ['protected'],
      leadingUnderscore: 'allow',
      format: ['camelCase']
    }, {
      selector: 'typeLike',
      format: ['PascalCase']
    }, {
      selector: 'parameter',
      format: ['camelCase', 'PascalCase'],
      leadingUnderscore: 'allow'
    }, {
      selector: 'enumMember',
      format: ['PascalCase', 'UPPER_CASE']
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
}, globalIgnores(['**/node_modules', '**/lib', '**/dist', 'packages/**'])]);
