/** @type {import('jest').Config} */
const config = {
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest'
    ]
  },
  testMatch: [
    '**/(__tests__|test)/**/*.(t|j)s?(x)'
  ]
}

module.exports = config