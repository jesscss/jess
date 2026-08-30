import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['scripts/release/__tests__/**/*.test.ts'],
    testTimeout: 30_000,
    reporters: [['tree', { summary: true }]]
  }
});
