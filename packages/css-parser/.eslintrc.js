module.exports = {
  extends: '../../.eslintrc.js',
  root: true,
  overrides: [
    {
      files: ['*.ts'],
      rules: {
        '@typescript-eslint/no-confusing-void-expression': 'off'
      }
    }
  ]
}