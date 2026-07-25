import { mergeConfig, defineConfig } from 'vitest/config';
import base, { sharedExclude } from '../../vitest.config.js';

// `sharedExclude` FIRST: setting `exclude` replaces vitest's default, and
// without `**/node_modules/**` this project walked pnpm's workspace symlinks
// and collected 578 files out of its own `node_modules`. See vitest.config.ts.
const exclude = [
  ...sharedExclude,
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
