import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'css-parser2',
    include: ['test/**/*.ts', '**/__tests__/**/*.ts'],
    globals: true
  }
})