import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'css-parser',
    include: ['test/**/*.ts', '**/__tests__/**/*.ts'],
    globals: true,
    setupFiles: ['../../test/setup.ts'],
    coverage: {
      enabled: true,
      include: ['src/**/*.ts'],
      100: true
    }
  }
})