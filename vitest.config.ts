import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import circleDependency from 'vite-plugin-circular-dependency';
import parseman from 'parseman/plugin';

export default defineConfig({
  plugins: [
    // Compiles grammars that import parseman `with { type: 'macro' }` at build
    // time. No-op for files without the macro attribute, so it's safe globally.
    parseman.vite(),
    circleDependency()
  ],
  resolve: {
    // Resolve workspace packages to their "source" export (src/*.ts) so tests run
    // against current source — no lib rebuild between edits, and no stale-lib phantom
    // failures. Vitest transforms the TS on the fly. Every @jesscss/* + styles-config
    // package exposes a "source" condition in its exports map.
    conditions: ['source', 'import', 'module', 'node', 'default'],
    mainFields: ['module', 'import', 'exports', 'main']
  },
  ssr: {
    resolve: {
      conditions: ['source', 'import', 'module', 'node', 'default']
    }
  },
  test: {
    /**
     * @todo - This doesn't work yet because the modules are mapped incorrectly somehow.
     *         But might make test running faster.
     */
    // experimental: {
    //   viteModuleRunner: false,
    // },
    watch: false,
    // Set TEST environment variable for packages that depend on it
    env: {
      TEST: 'true'
    },
    // Ensure environment variables are passed to test processes
    environment: 'node',
    onConsoleLog(log, type) {
      process[type === 'stderr' ? 'stderr' : 'stdout'].write(log + '\n')
      return false
    },
    testTimeout: 30_000,
    reporters: [['tree', { summary: true }]],
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
            'packages/css-parser/test/perf.test.ts',
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
