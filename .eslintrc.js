const jsRules = {
  /**
   * Okay tryyyying not to bikeshed here but I've never Standard JS's
   * formatting preference for space before in use before using StandardJS
   */
  'space-before-function-paren': ['error', {
    anonymous: 'never',
    named: 'never',
    asyncArrow: 'always'
  }],
  camelcase: ['warn', {
    ignoreDestructuring: true,
    properties: 'never'
  }],
  /** Seems like a silly rule */
  'eol-last': 0
}
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true
  },
  extends: ['standard'],
  rules: {
    ...jsRules
  },
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      plugins: ['@typescript-eslint'],
      extends: [
        'standard-with-typescript'
      ],
      parserOptions: {
        parser: '@typescript-eslint/parser',
        project: './tsconfig.json'
      },
      rules: {
        ...jsRules,
        'func-call-spacing': 0,
        '@typescript-eslint/func-call-spacing': 'error',

        /** conflicts with https://typescript-eslint.io/rules/no-floating-promises/ */
        'no-void': 0,
        '@typescript-eslint/space-before-function-paren': ['error', {
          anonymous: 'never',
          named: 'never',
          asyncArrow: 'always'
        }],
        /** Sometimes this forces awkward assignments */
        '@typescript-eslint/consistent-type-assertions': 0,
        /**
         * Some methods return a promise as a convenience, like the router,
         * but it's not necessary to always prepend "void"
         */
        '@typescript-eslint/no-floating-promises': ['warn', {
          ignoreVoid: true
        }],
        /**
         * This needs to be a warning because it's in conflict with TypeScript's
         * decorator behavior.
         *
         * @see: https://github.com/typescript-eslint/typescript-eslint/issues/546
         */
        '@typescript-eslint/consistent-type-imports': ['warn', {
          prefer: 'type-imports'
        }],

        /**
         * Loosen some rules to not force as much code refactoring
         * See individual rules for what issues these can cause.
         */
        '@typescript-eslint/strict-boolean-expressions': 0,
        '@typescript-eslint/restrict-template-expressions': 0,
        '@typescript-eslint/method-signature-style': 0,
        '@typescript-eslint/explicit-function-return-type': 0
      }
    },
    /** Test eslinting rules */
    {
      files: ['**/test/**/*.{js,ts}', '**/__tests__/*.{js,ts}', '**/*.test.{js,ts}'],
      env: {
        node: true,
        mocha: true
      },
      rules: {
        '@typescript-eslint/no-non-null-assertion': 0
      }
    }
  ]
}