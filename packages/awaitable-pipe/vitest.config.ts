import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'awaitable-pipe',
    testTimeout: 10_000,
    watch: false,
    include: ['test/**/*.ts', '**/__tests__/**/*.ts'],
    globals: true,
    setupFiles: ['../../test/setup.ts'],
    coverage: {
      reporter: ['text'],
      include: ['src/**/*.ts'],
      enabled: true,
      thresholds: {
        statements: 100,
        functions: 100,
        branches: 100,
        lines: 100
      }
    }
  }
});


