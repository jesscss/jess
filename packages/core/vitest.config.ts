import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import circleDependency from 'vite-plugin-circular-dependency';

export default defineConfig({
  root: __dirname,
  plugins: [
    circleDependency()
  ],
  resolve: {
    mainFields: ['import', 'module', 'exports', 'main']
  },
  test: {
    name: 'core',
    watch: false,
    env: {
      TEST: 'true'
    },
    environment: 'node',
    testTimeout: 30_000,
    reporters: [['tree', { summary: true }]],
    globals: true,
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.spec.ts',
      'test/**/*.test.ts',
      'test/**/*.spec.ts'
    ],
    exclude: [
      'test/setup.ts',
      'node_modules/**',
      'dist/**',
      'lib/**',
      '**/*bench*'
    ],
    setupFiles: [resolve(__dirname, '../../test/setup.ts')],
    coverage: {
      enabled: false,
      provider: 'v8'
    }
  }
});
