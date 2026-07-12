import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'jess',
    watch: false,
    include: ['test/**/*.ts', '**/__tests__/**/*.ts'],
    globals: true,
    setupFiles: ['../../test/setup.ts']
    // coverage: {
    //   enabled: true,
    //   include: ['src/**/*.ts'],
    //   100: true
    // }
  }
})