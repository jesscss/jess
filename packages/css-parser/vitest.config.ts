import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'css-parser',
    include: ['test/**/*.ts', '**/__tests__/**/*.ts'],
    globals: true
  }
})