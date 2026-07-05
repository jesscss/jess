/**
 * Profiling test to isolate hot paths in the functional CSS grammar.
 * Run with: pnpm vitest run test/perf-profile.test.ts
 */
import { describe, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveLessTestDataRoot } from './test-data.js';
import { parseCssFn } from '../src/functional-parser.js';

const testData = resolveLessTestDataRoot();
const bootstrap = fs.readFileSync(
  path.join(testData, 'tests-config/3rd-party/bootstrap4.css'),
  'utf8'
);

const N = 20;

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function bench(label: string, fn: () => void, n = N): number {
  for (let i = 0; i < 3; i++) {
    fn();
  } // warm up
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const med = median(times);
  console.log(`  ${label}: ${med.toFixed(2)}ms median`);
  return med;
}

describe('CSS parser hotpath profile', () => {
  test('baseline - full parseCssFn() (includes trivia map)', () => {
    bench('Full parse', () => {
      parseCssFn(bootstrap);
    });
  });

  test('just the low-level parse (no AST build)', () => {
    const timesTotal: number[] = [];

    for (let i = 0; i < 3; i++) {
      parseCssFn(bootstrap);
    } // warm up

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      parseCssFn(bootstrap);
      timesTotal.push(performance.now() - t0);
    }

    console.log(`  Full parse median: ${median(timesTotal).toFixed(2)}ms`);
  });

  test('repeated parse stability', () => {
    const tFull = bench('parseCssFn', () => {
      parseCssFn(bootstrap);
    });
    console.log(`  Median: ${tFull.toFixed(2)}ms`);
  });
});
