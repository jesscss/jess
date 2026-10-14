import { configDefaults, mergeConfig, defineConfig } from 'vitest/config';
import base from '../../../../vitest.config.js';

/*
 * Setting `exclude` replaces vitest's defaults, so they are spread back in: as a
 * project of the root config this package uses the default `include`, which
 * without the default `node_modules` exclude collects every test file shipped
 * in node_modules.
 */
const exclude = [
  ...configDefaults.exclude,
  ...(process.env.TEST_DEBUG === 'true' ? [] : ['test/debug-*.test.ts']),
  ...(process.env.TEST_PERF === 'true' ? [] : ['test/perf.test.ts'])
];

export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: 'less-parser',
      exclude,

      // Coverage configuration for less-parser
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/productions.ts'],
        exclude: [
          '**/*.test.ts',
          '**/*.spec.ts',
          '**/node_modules/**',
          '**/lib/**',
          '**/dist/**'
        ]

        // Keep reporting scoped to parser productions without hard-gating coverage.
      }
    }
  })
);
