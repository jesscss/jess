import {
  globalIgnores
} from 'eslint/config';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import {
  FlatCompat
} from '@eslint/eslintrc';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import Module, { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const typescript6ApiPath = require.resolve('@typescript/typescript6');
const typescript6Api = require('@typescript/typescript6');
const originalResolveFilename = Module._resolveFilename;

typescript6Api.Extension ??= {
  Cjs: '.cjs',
  Cts: '.cts',
  Js: '.js',
  Jsx: '.jsx',
  Mjs: '.mjs',
  Mts: '.mts',
  Ts: '.ts',
  Tsx: '.tsx'
};

Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'typescript') {
    return typescript6ApiPath;
  }
  if (request.startsWith('typescript/lib/')) {
    return require.resolve(`@typescript/typescript6/${request.slice('typescript/'.length)}`);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { default: tseslint } = await import('typescript-eslint');

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

  // Disallow single-line blocks like: `if (x) { y(); }`
  // so ESLint can auto-fix to a multiline block.
  '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],

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
      '@typescript-eslint': tseslint.plugin,
      import: importPlugin
    }
  }, {
    files: ['**/*.js', '**/*.mjs'],

    rules: {
      ...jsRules,
      curly: ['error', 'all'],
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
      curly: ['error', 'all'],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      'no-void': 0,
      '@typescript-eslint/consistent-type-assertions': 0,
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      // Enforce runtime-correct ESM specifiers in TS source:
      // - relative imports must include `.js`
      // - directory imports like `./foo` are banned; use `./foo/index.js`
      'import/extensions': ['error', 'ignorePackages', {
        js: 'always',
        mjs: 'always',
        cjs: 'always'
      }],

      '@typescript-eslint/no-floating-promises': ['warn', {
        ignoreVoid: true
      }],

      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
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
      },
      // Destructured bindings may mirror underscored object keys (`const { _x } = o`).
      {
        selector: 'variable',
        modifiers: ['destructured'],
        leadingUnderscore: 'allow',
        format: ['camelCase', 'UPPER_CASE', 'PascalCase', 'snake_case']
      },
      {
        selector: 'parameter',
        modifiers: ['destructured'],
        leadingUnderscore: 'allow',
        format: ['camelCase', 'UPPER_CASE', 'PascalCase', 'snake_case']
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
      },
      {
        selector: 'parameter',
        modifiers: ['unused'],
        format: ['camelCase', 'PascalCase', 'UPPER_CASE', 'snake_case'],
        leadingUnderscore: 'allow'
      }, {
        selector: 'objectLiteralProperty',
        filter: {
          regex: '^\\d+$',
          match: true
        },
        format: [] // Allow numeric property names
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
      '@typescript-eslint/no-unused-vars': 0,
      curly: ['error', 'all']
    }
  }, globalIgnores(['**/node_modules', '**/lib', '**/dist', 'packages/**/lib', 'packages/**/dist'])
]);
