import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'jess',
    include: ['test/**/*.ts', '**/__tests__/**/*.ts'],
    globals: true
    // coverage: {
    //   enabled: true,
    //   include: ['src/**/*.ts'],
    //   100: true
    // }
  }
})