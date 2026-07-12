#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

import {
  Any,
  Context,
  List,
  callWithContext,
  defineFunction
} from '../packages/core/lib/index.js';

const iterations = Number.parseInt(process.argv[2] ?? '2000', 10);
const warmup = Math.min(100, Math.max(0, Math.floor(iterations / 10)));

if (!Number.isFinite(iterations) || iterations < 1) {
  throw new TypeError('Usage: node scripts/measure-callwithcontext-rawargs.mjs [iterations]');
}

const context = new Context();
const arg = new Any('raw-red');
const plain = function plainEcho(value) {
  return value;
};
const metadata = defineFunction(
  'metadata-echo',
  async function metadataEcho(value) {
    if (this.rawArgs.value[0] !== arg) {
      throw new Error('Expected rawArgs to preserve the original argument node');
    }
    return value;
  },
  { params: [{ name: 'value', type: Any }] }
);

async function measure(label, fn) {
  const samples = [];
  for (let i = 0; i < iterations + warmup; i++) {
    const start = performance.now();
    await fn();
    const duration = performance.now() - start;
    if (i >= warmup) {
      samples.push(duration);
    }
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  console.log(`${label}: median ${median.toFixed(4)}ms, mean ${mean.toFixed(4)}ms, n=${samples.length}`);
}

await measure('plain positional callWithContext', () => callWithContext(context, plain, arg));
await measure('metadata rawArgs callWithContext', () => callWithContext(context, metadata, new List([arg])));
