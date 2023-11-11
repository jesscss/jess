import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'css-parser',
    watch: false,
    include: ['test/**/*.ts', '**/__tests__/**/*.ts'],
    globals: true,
    setupFiles: ['../../test/setup.ts'],
    watchExclude: ['**/*', '!**/*.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      100: true
    }
  }
})