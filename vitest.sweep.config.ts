import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import parseman from 'parseman/plugin';
import { workspaceSrcAliases } from './scripts/workspace-src-aliases.mjs';

const root = dirname(fileURLToPath(import.meta.url));

function lessTestDataRoot(): string | undefined {
  const env = process.env.LESS_TEST_DATA_ROOT;
  if (env && existsSync(resolve(env, 'tests-unit'))) {
    return env;
  }
  const candidates = [resolve(root, '../less.js/packages/test-data')];
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
    candidates.push(resolve(dirname(resolve(root, gitDir)), '../less.js/packages/test-data'));
  } catch { /* ignore */ }
  return candidates.find(c => existsSync(resolve(c, 'tests-unit')));
}

/**
 * RUNG 8 SWEEP — whole core extend suite through real renders with the differential sink installed.
 * One fork with one module registry (`maxWorkers: 1`, `isolate: false` — vitest 4's replacement for
 * `poolOptions.forks.singleFork`) so one accumulator (sweep-sink.ts module Map) spans every extend test file.
 */
export default defineConfig({
  plugins: [parseman.vite({})],
  resolve: {
    alias: workspaceSrcAliases(root),
    mainFields: ['module', 'import', 'exports', 'main']
  },
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    env: {
      TEST: 'true',
      ...(lessTestDataRoot() ? { LESS_TEST_DATA_ROOT: lessTestDataRoot()! } : {})
    },
    testTimeout: 60_000,
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    setupFiles: [
      resolve(root, './test/setup.ts'),
      resolve(root, './packages/core/src/tree/extend/__tests__/sweep-sink.ts')
    ],
    include: [
      'packages/core/src/tree/**/__tests__/**/*.test.ts',
      'packages/core/src/tree/**/*.test.ts'
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'lib/**',
      '**/*bench*',

      /*
       * Perf/scaling stress tests assert TIMING; the sink doubles extend work (own + oracle) so they
       * blow their budget. They add only synthetic `.a-N` volume, no new SHAPES — excluded from the
       * sweep. (They are unaffected in the normal, sink-free suite runs.)
       */
      'packages/core/src/tree/util/__tests__/extend-oom-stress.test.ts',
      'packages/core/src/tree/__tests__/render-scaling.test.ts',
      'packages/core/src/tree/extend/__tests__/**'
    ]
  }
});
