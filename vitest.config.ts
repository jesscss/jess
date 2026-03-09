import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import circleDependency from 'vite-plugin-circular-dependency';
import { TestTypeReporter } from './test/vitest-test-type-reporter';

export default defineConfig({
  plugins: [
    circleDependency()
  ],
  resolve: {
    // Use built output (import/main) so workspace packages pick up built lib/ after pnpm build.
    // Run tests from each package directory (e.g. cd packages/jess && pnpm test) after building
    // dependencies (e.g. pnpm --filter @jesscss/core build) so tests run against built code.
    mainFields: ['import', 'module', 'exports', 'main']
  },
  test: {
    watch: false,
    // Set TEST environment variable for packages that depend on it
    env: {
      TEST: 'true'
    },
    deps: {
      // Transpile workspace libs instead of treating them as prebuilt node_modules
      inline: [/^@jesscss\//]
    },
    server: {
      deps: {
        inline: [/^@jesscss\//]
      }
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
    // Keep output manageable; custom reporter prints per “test type” lines.
    reporters: ['default', new TestTypeReporter()],
    // Enable globals for describe, test, etc.
    globals: true,
    // Include all test files from all packages - use absolute paths relative to config file

    projects: [
      'packages/*',
      {
        extends: true,
        test: {
          include: [
            '**/__tests__/**/*.test.ts',
            '**/__tests__/**/*.spec.ts',
            'test/**/*.test.ts',
            'test/**/*.spec.ts'
          ],
          exclude: [
            'test/setup.ts',
            'node_modules/**',
            'dist/**',
            'lib/**',
            '**/*bench*'
          ]
        }
      }
    ],

    // Global setup file - use absolute path so it works from any subfolder
    setupFiles: [resolve(__dirname, './test/setup.ts')],
    // Disable coverage by default to save memory
    coverage: {
      enabled: false,
      provider: 'v8'
    }
  }
});
