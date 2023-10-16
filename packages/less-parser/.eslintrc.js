module.exports = {
  extends: '../../.eslintrc.js',
  root: true,
  parserOptions: {
    project: './tsconfig.json'
  },
  rules: {
    'no-return-assign': 'off'
  }
}