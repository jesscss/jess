/**
 * Parse-speed benchmarks for the macro-compiled functional Less grammar
 * (`parseLessFn`), with a side-by-side reference against Less.js 4.x `parse()`.
 *
 * Run: `pnpm --filter @jesscss/less-parser exec vitest run test/perf.test.ts`
 * Or from repo root: `npx vitest run --project less-parser test/perf.test.ts`
 */
import { describe, test } from 'vitest';
import less from 'less';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLessFn } from '../src/grammar.js';
import { resolveLessTestDataRoot } from './test-data.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const ITERATIONS = 20;
const WARMUP = 3;

const benchmarkLess = fs.readFileSync(
  path.resolve(testDir, '../../jess/benchmark/benchmark.less'),
  'utf8'
);
/** Same text with `@import` lines removed so Less 4.x can parse without missing files. */
const benchmarkLessNoImports = benchmarkLess
  .split('\n')
  .filter(line => !/^\s*@import\b/.test(line))
  .join('\n');

const bootstrap = fs.readFileSync(
  path.join(resolveLessTestDataRoot(), 'tests-config/3rd-party/bootstrap4.css'),
  'utf8'
);

function readPackageVersion(packageJsonPath: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && 'version' in parsed) {
      const version = (parsed as Record<string, unknown>).version;
      return typeof version === 'string' ? version : undefined;
    }
  } catch {
    // try next candidate
  }
  return undefined;
}

const lessVersion: string = (() => {
  const candidates = [
    require.resolve('less/package.json'),
    path.resolve(testDir, '../../../node_modules/less/package.json')
  ];
  for (const packageJsonPath of candidates) {
    const version = readPackageVersion(packageJsonPath);
    if (version) {
      return version;
    }
  }
  return 'unknown';
})();

type Timings = { median: number; mean: number; min: number; max: number };

function median(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}

function timeSync(fn: (source: string) => void, source: string, iterations = ITERATIONS): Timings {
  for (let i = 0; i < WARMUP; i++) {
    fn(source);
  }
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn(source);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    median: median(times),
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    min: times[0]!,
    max: times[times.length - 1]!
  };
}

async function timeAsync(
  fn: (source: string) => Promise<void>,
  source: string,
  iterations = ITERATIONS
): Promise<Timings> {
  for (let i = 0; i < WARMUP; i++) {
    await fn(source);
  }
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn(source);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    median: median(times),
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    min: times[0]!,
    max: times[times.length - 1]!
  };
}

function logTimings(label: string, kb: number, stats: Timings): void {
  console.log(`\n  ${label} (${kb.toFixed(1)}KB)`);
  console.log(`    Median: ${stats.median.toFixed(2)}ms  (${(stats.median / kb).toFixed(3)} ms/KB)`);
  console.log(`    Mean:   ${stats.mean.toFixed(2)}ms`);
  console.log(`    Min:    ${stats.min.toFixed(2)}ms  Max: ${stats.max.toFixed(2)}ms`);
}

describe('Less parser benchmark (parseLessFn)', () => {
  test(`benchmark.less (${(benchmarkLess.length / 1024).toFixed(1)}KB) - ${ITERATIONS} iterations`, () => {
    const stats = timeSync((source) => {
      const { errors } = parseLessFn(source);
      if (errors.length > 0) {
        throw new Error(`parseLessFn reported ${errors.length} error(s)`);
      }
    }, benchmarkLess);
    logTimings('Jess parseLessFn', benchmarkLess.length / 1024, stats);
  });
});

describe(`Less parser vs Less.js ${lessVersion} parse()`, () => {
  test(`benchmark.less without @imports (${(benchmarkLessNoImports.length / 1024).toFixed(1)}KB)`, async () => {
    const kb = benchmarkLessNoImports.length / 1024;
    const lessStats = await timeAsync(
      source => less.parse(source, { math: 'parens-division' }).then(() => undefined),
      benchmarkLessNoImports
    );
    const jessStats = timeSync((source) => {
      const { errors } = parseLessFn(source);
      if (errors.length > 0) {
        throw new Error(`parseLessFn reported ${errors.length} error(s)`);
      }
    }, benchmarkLessNoImports);

    logTimings('Less 4.x parse()', kb, lessStats);
    logTimings('Jess parseLessFn', kb, jessStats);
    const ratio = jessStats.median / lessStats.median;
    console.log(`\n  Jess / Less parse ratio: ${ratio.toFixed(2)}× (median)`);
    console.log('  Note: raw benchmark.less has @imports to files not in this repo;');
    console.log('  Less comparison uses the same text with @import lines stripped.');
  });

  test(`bootstrap4.css (${(bootstrap.length / 1024).toFixed(1)}KB)`, async () => {
    const kb = bootstrap.length / 1024;
    const lessStats = await timeAsync(
      source => less.parse(source, { math: 'parens-division' }).then(() => undefined),
      bootstrap
    );
    const jessStats = timeSync((source) => {
      const { errors } = parseLessFn(source);
      if (errors.length > 0) {
        throw new Error(`parseLessFn reported ${errors.length} error(s)`);
      }
    }, bootstrap);

    logTimings('Less 4.x parse()', kb, lessStats);
    logTimings('Jess parseLessFn', kb, jessStats);
    const ratio = jessStats.median / lessStats.median;
    console.log(`\n  Jess / Less parse ratio: ${ratio.toFixed(2)}× (median)`);
  });
});
