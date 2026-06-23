import { describe, test } from 'vitest';
import { CssParserChevrotain as CssParser } from '../src/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { resolveLessTestDataRoot } from './test-data.js';

const testData = resolveLessTestDataRoot();
const bootstrap = fs.readFileSync(
  path.join(testData, 'tests-config/3rd-party/bootstrap4.css'),
  'utf8'
);

const cssParser = new CssParser({ legacyMode: true });

describe('CSS parser benchmark', () => {
  test(`bootstrap4.css (${(bootstrap.length / 1024).toFixed(1)}KB) - 20 iterations`, () => {
    // Warm up
    for (let i = 0; i < 3; i++) {
      cssParser.parse(bootstrap);
    }

    const iterations = 20;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const { errors } = cssParser.parse(bootstrap);
      const elapsed = performance.now() - start;
      times.push(elapsed);
      if (i === 0 && errors.length > 0) {
        console.log(`  ⚠ ${errors.length} parse error(s)`);
      }
    }

    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const min = times[0];
    const max = times[times.length - 1];

    console.log(`\n  Iterations: ${iterations}`);
    console.log(`  Median: ${median.toFixed(2)}ms`);
    console.log(`  Mean:   ${mean.toFixed(2)}ms`);
    console.log(`  Min:    ${min.toFixed(2)}ms`);
    console.log(`  Max:    ${max.toFixed(2)}ms`);
  });
});
