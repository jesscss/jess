import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    watch: false,
    // Set TEST environment variable for packages that depend on it
    env: {
      TEST: 'true'
    },
    // Ensure environment variables are passed to test processes
    environment: 'node',
    // Run tests sequentially to reduce memory usage
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        maxForks: 1,
        minForks: 1
      }
    },
    // Set low concurrency - run one test at a time
    maxConcurrency: 1,
    // Increase timeout since we're running sequentially
    testTimeout: 30_000,
    // Reduce memory usage
    isolate: true,
    // Verbose output - show all it() and test() lines regardless of nesting
    reporters: ['verbose'],
    // Enable globals for describe, test, etc.
    globals: true,
    // Include all test files from all packages
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/test/**/*.spec.ts',
      'packages/*/**/__tests__/**/*.ts',
      'test/**/*.test.ts',
      'test/**/*.spec.ts'
    ],
    // Exclude setup files and build artifacts
    exclude: [
      '**/test/setup.ts',
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
      '**/src/old_tree/**/*'
    ],
    // Global setup file - use absolute path so it works from any subfolder
    setupFiles: [resolve(__dirname, './test/setup.ts')],
    // Disable coverage by default to save memory
    coverage: {
      enabled: false
    }
  }
});
