module.exports = {
  extends: '../../.eslintrc.js',
  rules: {
    '@typescript-eslint/no-base-to-string': 'off',
    /** Use everywhere? */
    '@typescript-eslint/prefer-nullish-coalescing': 'off',
    '@typescript-eslint/no-misused-promises': [
      'error',
      {
        checksVoidReturn: {
          arguments: false
        }
      }
    ]
  }
}