import { mergeConfig, defineConfig, configDefaults } from 'vitest/config';
import base from '../../vitest.config.js';

// `exclude` REPLACES vitest's defaults rather than extending them, so the defaults
// (notably `**/node_modules/**`) must be spread back in. Without them vitest collected
// the `test/**` directories shipped inside third-party packages — 114 files and 36
// failures from `data-structure-typed`, `bitset` and `rollup-plugin-visualizer`, none of
// them less-parser's. scss/css/jess-parser do not set `exclude` at all, which is why the
// breakage was unique to this package.
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
        // `src/productions.ts` was the Chevrotain-era spec file; it no longer exists (and
        // per the repo rule must not be recreated). The grammars are the sources now.
        include: ['src/grammar.ts', 'src/ast/grammar.ts'],
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
