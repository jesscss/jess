import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'core',
    include: ['test/**/*.ts', '!test/setup.ts', '**/__tests__/**/*.ts', '!src/old_tree/**/*'],
    globals: true,
    setupFiles: ['../../test/setup.ts'],
    coverage: {
      enabled: true,
      reporter: ['text'],
      include: ['src/**/*.ts'],
      100: true
    }
  }
})