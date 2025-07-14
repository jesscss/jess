import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core',
    timeout: 30_000,
    watch: false,
    include: ['test/**/*.ts', '!test/setup.ts', '**/__tests__/**/*.ts', '!src/old_tree/**/*'],
    globals: true,
    setupFiles: ['../../test/setup.ts', './test/setup.ts'],
    coverage: {
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // eslint-disable-next-line @typescript-eslint/naming-convention
      100: true
    }
  }
});