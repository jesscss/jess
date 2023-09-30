import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'ast',
    include: ['test/**/*.ts', '!test/setup.ts', '**/__tests__/**/*.ts'],
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text'],
      include: ['src/**/*.ts'],
      100: true
    }
  }
})