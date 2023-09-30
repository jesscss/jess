module.exports = {
  extends: '../../.eslintrc.js',
  root: true,
  overrides: [{
    files: ['*.ts', '*.tsx'],
    parserOptions: {
      // parser: '@typescript-eslint/parser',
      project: './tsconfig.json'
    },
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
  }]
}