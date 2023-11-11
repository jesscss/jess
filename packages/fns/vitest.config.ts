import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@jesscss/fns',
    watch: false,
    include: ['src/__tests__/**/*.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // includeSource: ['**/src/**/*.ts'],
    globals: true
    // coverage: {
    //   enabled: true,
    //   include: ['src/**/*.ts'],
    //   100: true
    // }
  }
})