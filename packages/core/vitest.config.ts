import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'core',
    watch: false,
    include: ['test/**/*.ts', '!test/setup.ts', '**/__tests__/**/*.ts', '!src/old_tree/**/*'],
    globals: true,
    setupFiles: ['../../test/setup.ts'],
    coverage: {
      reporter: ['text'],
      include: ['src/**/*.ts'],
      100: true
    }
  }
})