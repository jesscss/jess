#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import path from 'node:path';

import { Compiler } from '../packages/jess/lib/index.js';
import lessPlugin from '../packages/jess-plugin-less/lib/index.js';
import { lessCompatPlugin } from '../packages/jess-plugin-less-compat/lib/index.js';

const require = createRequire(import.meta.url);

const DEFAULT_FIXTURES = [
  'tests-unit/functions/functions.less',
  'tests-unit/import/import-reference.less',
  'tests-unit/mixins-guards/mixins-guards.less',
  'tests-unit/extend-chaining/extend-chaining.less',
  'tests-unit/media/media.less'
];

function readNumberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative number`);
  }
  return Math.floor(value);
}

function readFixtures() {
  const index = process.argv.indexOf('--fixture');
  if (index < 0) {
    return DEFAULT_FIXTURES;
  }
  return process.argv.slice(index + 1).filter(arg => !arg.startsWith('--'));
}

function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    mean,
    min: sorted[0],
    max: sorted.at(-1)
  };
}

function formatMs(value) {
  return `${value.toFixed(2)}ms`;
}

const iterations = readNumberArg('--iterations', 10);
const warmup = readNumberArg('--warmup', 1);
const fixtures = readFixtures();
const testDataRoot = path.dirname(require.resolve('@less/test-data'));

const compiler = new Compiler({
  output: {
    collapseNesting: true
  },
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin()
    ]
  }
});

for (const rel of fixtures) {
  const file = path.join(testDataRoot, rel);
  for (let i = 0; i < warmup; i++) {
    await compiler.render(file);
  }
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await compiler.render(file);
    times.push(performance.now() - start);
  }
  const result = summarize(times);
  console.log(`${rel}`);
  console.log(
    `  median=${formatMs(result.median)} mean=${formatMs(result.mean)} min=${formatMs(result.min)} max=${formatMs(result.max)}`
  );
}
