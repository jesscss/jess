import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'less-parser',
    watch: false,
    include: ['test/**/*.ts', '**/__tests__/**/*.ts'],
    globals: true,
    coverage: {
      include: ['src/**/*.ts'],
      // enabled: true,
      thresholds: {
        statements: 100,
        functions: 100,
        branches: 100,
        lines: 100
      }
    }
  }
});