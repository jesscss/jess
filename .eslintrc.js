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
  rules: {},
  overrides: [
    {
      files: ['*.js'],
      extends: ['standard'],
      rules: { ...jsRules }
    },
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
        'eol-last': 0,
        '@typescript-eslint/space-before-function-paren': jsRules['space-before-function-paren'],
        '@typescript-eslint/func-call-spacing': 'error',

        /** conflicts with https://typescript-eslint.io/rules/no-floating-promises/ */
        'no-void': 0,
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
         * Loosen some rules to not force to reduce verbosity forced by Standard TS
         */
        '@typescript-eslint/strict-boolean-expressions': 0,
        '@typescript-eslint/restrict-template-expressions': 0,
        '@typescript-eslint/method-signature-style': 0,
        '@typescript-eslint/explicit-function-return-type': 0,
        '@typescript-eslint/no-non-null-assertion': 0,
        '@typescript-eslint/consistent-type-definitions': 0,
        /** Chevrotain docs often alias $ to this */
        '@typescript-eslint/no-this-alias': 0,
        '@typescript-eslint/naming-convention': [
          'error',
          // {
          //   selector: 'default',
          //   format: ['camelCase']
          // },

          {
            selector: 'variable',
            format: ['camelCase', 'UPPER_CASE', 'PascalCase']
          },
          {
            selector: 'variable',
            modifiers: ['destructured'],
            format: null
          },

          {
            selector: 'memberLike',
            modifiers: ['private'],
            format: ['camelCase'],
            leadingUnderscore: 'require'
          },

          {
            selector: 'typeLike',
            format: ['PascalCase']
          }
        ]
      }
    },
    /** Test eslinting rules */
    {
      files: ['**/test/**/*.{js,ts}', '**/__tests__/*.{js,ts}', '**/*.test.{js,ts}'],
      env: {
        node: true,
        jest: true
      },
      rules: {
      }
    }
  ]
}