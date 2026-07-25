/**
 * MEASUREMENT-ONLY ESLint config. Not part of the build, not referenced by any
 * package script — it exists to answer "how many violations would rule X
 * produce if we turned it on at maximum strictness", so the landed config can
 * be argued from numbers instead of taste.
 *
 * Run through `scripts/lint-violation-report.mjs`, which emits per-rule /
 * per-file counts.
 */
import base from './eslint.config.mjs';
import regexp from 'eslint-plugin-regexp';
import jsdoc from 'eslint-plugin-jsdoc';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import grammarRules from './scripts/eslint-rules/grammar-rules.mjs';

const { default: tseslint } = await import('typescript-eslint');

const GRAMMAR_FILES = [
  'packages/css-parser/src/**/*.ts',
  'packages/less-parser/src/**/*.ts',
  'packages/scss-parser/src/**/*.ts',
  'packages/jess-parser/src/**/*.ts',
  'packages/internal-css-recognition/src/**/*.ts'
];

/**
 * Every rule the strict presets ship, promoted from `warn` to `error`.
 *
 * Presets come in two shapes (a single config object, or an array of them) and
 * some ship a trailing `undefined` option, which ESLint's schema validator
 * rejects outright — so both are normalised here.
 */
function allError(input) {
  const configs = (Array.isArray(input) ? input : [input]).flat();
  const rules = {};
  for (const config of configs) {
    for (const [name, setting] of Object.entries(config?.rules ?? {})) {
      const level = Array.isArray(setting) ? setting[0] : setting;
      if (level === 0 || level === 'off') {
        continue;
      }
      const options = (Array.isArray(setting) ? setting.slice(1) : [])
        .filter(option => option !== undefined && option !== null);
      rules[name] = ['error', ...options];
    }
  }
  return rules;
}

export default [
  ...base,
  {
    /*
     * Type-aware rules need `@typescript-eslint/parser` with project service, so
     * this block is `.ts` ONLY. Plain `.mjs`/`.js` are measured separately below.
     */
    files: ['packages/**/src/**/*.ts'],
    plugins: { regexp, jsdoc, sonarjs, unicorn, grammar: grammarRules },
    rules: {
      ...allError([regexp.configs['flat/all']]),
      ...allError([sonarjs.configs.recommended]),
      ...allError([unicorn.configs.all]),
      ...allError(tseslint.configs.strictTypeChecked),
      ...allError(tseslint.configs.stylisticTypeChecked),

      /*
       * `unicorn.configs.all` ships this as a bare `error`, but the rule's own
       * schema has `minItems: 1`, so ESLint 9 rejects the preset as written.
       */
      'unicorn/logical-assignment-operators': ['error', 'always'],

      complexity: ['error', 10],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['error', 60],
      'max-params': ['error', 4],
      'max-statements': ['error', 25],
      eqeqeq: ['error', 'always'],
      'no-else-return': ['error', { allowElseIf: false }],
      'prefer-const': 'error',
      'default-case': 'error',
      'no-fallthrough': 'error',
      'require-unicode-regexp': 'error',
      'no-magic-numbers': ['error', {
        ignore: [-1, 0, 1, 2],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        enforceConst: true
      }],

      'grammar/no-multiline-line-comments': 'error',
      '@stylistic/lines-around-comment': ['error', {
        beforeBlockComment: true,
        beforeLineComment: true,
        allowBlockStart: true,
        allowBlockEnd: true,
        allowObjectStart: true,
        allowObjectEnd: true,
        allowArrayStart: true,
        allowArrayEnd: true,
        allowClassStart: true,
        allowClassEnd: true,
        allowEnumStart: true,
        allowEnumEnd: true,
        allowInterfaceStart: true,
        allowInterfaceEnd: true,
        allowModuleStart: true,
        allowModuleEnd: true,
        allowTypeStart: true,
        allowTypeEnd: true
      }],

      // Naming conventions are explicitly out of scope by owner direction.
      '@typescript-eslint/naming-convention': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/filename-case': 'off',
      'sonarjs/no-commented-code': 'off'
    }
  },
  {
    files: GRAMMAR_FILES,
    plugins: { jsdoc, grammar: grammarRules },
    rules: {
      'grammar/no-line-comments': 'error',
      'grammar/no-multiline-line-comments': 'off',
      'grammar/no-literal-non-ascii-in-regex': 'error',
      'grammar/no-hand-rolled-keyword-regex': 'error',
      'grammar/no-regex-outside-combinator': 'error',
      'grammar/no-macro-hazards': 'error',
      '@stylistic/max-len': ['error', { code: 100, ignoreUrls: true }],
      '@stylistic/function-paren-newline': ['error', 'multiline-arguments'],
      '@stylistic/function-call-argument-newline': ['error', 'always'],
      'jsdoc/require-jsdoc': ['error', {
        contexts: [
          'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator',
          'Program > VariableDeclaration > VariableDeclarator'
        ],
        require: { FunctionDeclaration: true, ArrowFunctionExpression: false }
      }],
      'jsdoc/require-description': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-alignment': 'error',
      'jsdoc/no-undefined-types': 'off'
    }
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    plugins: { regexp, grammar: grammarRules },
    rules: {
      ...allError([regexp.configs['flat/all']]),
      'grammar/no-multiline-line-comments': 'error'
    }
  }
];
