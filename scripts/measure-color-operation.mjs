#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

import {
  Color,
  ColorFormat,
  Context,
  Dimension
} from '../packages/core/lib/index.js';

const iterations = Number.parseInt(process.argv[2] ?? '5000', 10);
const warmup = Math.min(200, Math.max(0, Math.floor(iterations / 10)));

if (!Number.isFinite(iterations) || iterations < 1) {
  throw new TypeError('Usage: node scripts/measure-color-operation.mjs [iterations]');
}

const context = new Context();
const color = new Color({ rgb: [120, 80, 40], alpha: 0.75 }, { format: ColorFormat.RGBA });
const dimension = new Dimension({ number: 5 });
const otherColor = new Color({ rgb: [10, 20, 30], alpha: 0.25 }, { format: ColorFormat.RGBA });

function measure(label, fn) {
  const samples = [];
  for (let i = 0; i < iterations + warmup; i++) {
    const start = performance.now();
    fn();
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

measure('Color.operate dimension add', () => color.operate(dimension, '+', context));
measure('Color.operate color add', () => color.operate(otherColor, '+', context));
