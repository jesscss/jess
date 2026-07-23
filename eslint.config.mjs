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
const { default: localRules } = await import('./scripts/eslint-rules/index.mjs');

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
  '@stylistic/padded-blocks': ['error', 'never'],

  // Consistency / DRY / organization nudges (all auto-fixable; `warn` because
  // `pnpm lint` is not yet a blocking gate — promote to `error` once a baseline
  // sweep lands). Run `pnpm lint:fix` on files you touch.
  'object-shorthand': ['warn', 'always'],
  'no-useless-rename': 'warn',
  'no-lonely-if': 'warn',
  'no-else-return': ['warn', { allowElseIf: false }],
  'no-unneeded-ternary': ['warn', { defaultAssignment: false }],
  'prefer-object-spread': 'warn',
  'dot-notation': 'warn',

  // Organization guardrails: a function that trips these is usually doing too
  // much / named like a sentence — a signal to split, not a hard limit.
  'max-depth': ['warn', 5],
  'max-params': ['warn', 6]
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

      // DRY / consistency (type-aware; auto-fixable). `warn` — see jsRules note.
      'import/no-duplicates': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',

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
  },

  // ---------------------------------------------------------------------------
  // LLM-quality REGRESSION PINS (local rules). ALL `warn` (advisory) by policy:
  // these are pins, not merge gates. Several are intentionally heuristic and
  // WILL surface some legitimate code; promotion of any to `error`/blocking
  // requires a measured <5% false-positive bake on real PRs. See
  // `scripts/eslint-rules/index.mjs` for the per-rule limitation notes.
  // ---------------------------------------------------------------------------

  // #2 Byte re-derivation — hot AST code only; serializers/debug are the
  // legitimate owners of byte scanning, so they are excluded.
  {
    files: ['packages/*/src/ast/**/*.{ts,tsx}'],
    ignores: [
      '**/serialize*.{ts,tsx}',
      '**/*debug*.{ts,tsx}',
      '**/__tests__/**',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}'
    ],
    plugins: { local: localRules },
    rules: {
      'local/no-serialize-rederivation': 'warn'
    }
  },

  // #3 Full-tree walk — best-effort, report-only; scoped to an explicit
  // allowlist of eval/render hot-path files (recursion is legitimate in
  // serialize/eval, so this stays advisory and narrowly targeted).
  {
    files: [
      'packages/core/src/ast/value-eval.ts',
      'packages/core/src/ast/eval*.ts',
      'packages/core/src/ast/evaluator*.ts',
      'packages/core/src/ast/render*.ts',
      'packages/core/src/ast/resolve*.ts'
    ],
    plugins: { local: localRules },
    rules: {
      'local/no-full-tree-walk-hot-path': 'warn'
    }
  },

  // #6 Oversized/duplicated choice — RETIRED. `choice()` in `src/…grammar.ts` is
  // an AUTHORED parseman macro DSL declaration (`import … from 'parseman' with
  // { type: 'macro' }`); the parseman compiler (`parseman.rolldown()` in tsdown)
  // expands it at build into `lib/` (gitignored), and THAT compiled output — not
  // the authored arm list — decides dispatch: disjoint arms become a switch
  // jump-table or a single integer compare each (no re-lex), and reference arms
  // keep dispatch parity via the fixpoint first-set recipe. So arm count on the
  // authored declaration is NOT a cost signal, and eslint only ever sees the
  // authored src. Genuine duplication (e.g. scss copy-pasting a statement-body
  // choice 26×) is a code-size/structure concern surfaced by the grammar audit,
  // not a line-count lint. See docs/perf/V8-ARCHITECTURE.md invariant 8 / R5.
  // Rule impl kept in scripts/eslint-rules for reference but intentionally unwired.

  // Deprecated DetachedRuleset AST node type. Allowlist: the plugin-transport
  // (`serialize.ts` uses the less.js-facing transport tag; `value-eval.ts`
  // declares the `PluginDetachedRuleset` transport interface) and the
  // grammar/CST `DetachedRuleset` productions (grammar files live outside
  // `src/ast`, so they are already out of scope).
  {
    files: ['packages/*/src/ast/**/*.{ts,tsx}'],
    ignores: [
      '**/serialize.ts',
      '**/value-eval.ts',
      '**/__tests__/**'
    ],
    plugins: { local: localRules },
    rules: {
      'local/no-deprecated-detached-ruleset': 'warn'
    }
  }, globalIgnores([
    '**/node_modules/**',
    '**/lib/**',
    '**/dist/**',
    '**/coverage/**',
    '.claude/worktrees/**',
    '.git/worktrees/**'
  ])
]);
