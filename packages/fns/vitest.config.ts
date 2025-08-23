import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@jesscss/fns',
    watch: false,
    include: ['src/__tests__/**/*.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // includeSource: ['**/src/**/*.ts'],
    globals: true,
    coverage: {
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