module.exports = {
  extends: '../../.eslintrc.js',
  root: true,
  parserOptions: {
    project: './tsconfig.json'
  },
  rules: {
    '@typescript-eslint/return-await': 'off'
  }
}