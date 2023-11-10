import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@jesscss/fns',
    // include: ['**/__tests__/**/*.ts'],
    includeSource: ['**/src/**/*.ts'],
    globals: true
    // coverage: {
    //   enabled: true,
    //   include: ['src/**/*.ts'],
    //   100: true
    // }
  }
})