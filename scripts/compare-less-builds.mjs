#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const options = { phase: 'parse-render', pairs: 45, warmup: 20, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    if (!['before-root', 'after-root', 'fixture', 'phase', 'pairs', 'warmup'].includes(key)) {
      throw new Error(`Unknown arg: ${arg}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }
    if (key === 'pairs' || key === 'warmup') {
      options[key] = Number(value);
      if (!Number.isInteger(options[key]) || options[key] < 0) {
        throw new Error(`${arg} must be a non-negative integer`);
      }
    } else {
      options[key] = value;
    }
  }
  if (!options['before-root'] || !options['after-root'] || !options.fixture) {
    throw new Error('--before-root, --after-root, and --fixture are required');
  }
  if (!['parse-render', 'render'].includes(options.phase)) {
    throw new Error('--phase must be parse-render or render');
  }
  return options;
}

async function loadBuild(root) {
  const module = relative => import(pathToFileURL(path.resolve(root, relative)).href);
  const [{ Context, createRenderBuffer, finalizeFlatRenderBuffer }, { default: lessPlugin }, { lessCompatPlugin }] = await Promise.all([
    module('packages/core/lib/index.js'),
    module('packages/jess-plugin-less/lib/index.js'),
    module('packages/jess-plugin-less-compat/lib/index.js')
  ]);
  return { Context, createRenderBuffer, finalizeFlatRenderBuffer, lessPlugin, lessCompatPlugin };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const index = (values.length - 1) * 0.5;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const median = sorted.length === 0
    ? 0
    : lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  return { mean, median, min: sorted[0], max: sorted.at(-1) };
}

function outputDigest(output) {
  return {
    bytes: Buffer.byteLength(output),
    sha256: createHash('sha256').update(output).digest('hex')
  };
}

async function measure(build, fixture, phase) {
  const context = new build.Context({ output: { collapseNesting: true } }, [
    build.lessPlugin(),
    build.lessCompatPlugin()
  ]);
  const started = performance.now();
  const parsed = await context.getTree(fixture);
  if (!parsed.node) {
    throw new Error(`Parse failed: ${fixture}`);
  }
  context.root = parsed.node;
  const renderStarted = phase === 'render' ? performance.now() : started;
  const buffer = build.createRenderBuffer('flat');
  buffer.shareWriter = true;
  await parsed.node.render(context, buffer, { context, collapseNesting: true });
  const output = build.finalizeFlatRenderBuffer(buffer);
  return { elapsedMs: performance.now() - renderStarted, output: outputDigest(output) };
}

const options = parseArgs(process.argv.slice(2));
const fixture = path.resolve(options.fixture);
const before = await loadBuild(options['before-root']);
const after = await loadBuild(options['after-root']);

for (let i = 0; i < options.warmup; i++) {
  await measure(before, fixture, options.phase);
  await measure(after, fixture, options.phase);
}

const pairs = [];
for (let i = 0; i < options.pairs; i++) {
  const afterFirst = i % 2 === 1;
  let beforeResult;
  let afterResult;
  if (afterFirst) {
    afterResult = await measure(after, fixture, options.phase);
    beforeResult = await measure(before, fixture, options.phase);
  } else {
    beforeResult = await measure(before, fixture, options.phase);
    afterResult = await measure(after, fixture, options.phase);
  }
  pairs.push({
    index: i + 1,
    order: afterFirst ? 'after-before' : 'before-after',
    beforeMs: beforeResult.elapsedMs,
    afterMs: afterResult.elapsedMs,
    deltaMs: afterResult.elapsedMs - beforeResult.elapsedMs,
    ratio: beforeResult.elapsedMs === 0 ? 0 : (afterResult.elapsedMs - beforeResult.elapsedMs) / beforeResult.elapsedMs,
    beforeOutput: beforeResult.output,
    afterOutput: afterResult.output
  });
}

const beforeSummary = summarize(pairs.map(pair => pair.beforeMs));
const afterSummary = summarize(pairs.map(pair => pair.afterMs));
const deltas = summarize(pairs.map(pair => pair.deltaMs));
const wins = pairs.filter(pair => pair.afterMs < pair.beforeMs).length;
const byteIdentical = pairs.every(pair =>
  pair.beforeOutput.bytes === pair.afterOutput.bytes
  && pair.beforeOutput.sha256 === pair.afterOutput.sha256
);
const result = {
  fixture,
  phase: options.phase,
  warmup: options.warmup,
  pairs: options.pairs,
  before: beforeSummary,
  after: afterSummary,
  deltas,
  medianRatioPercent: beforeSummary.median === 0 ? 0 : (afterSummary.median - beforeSummary.median) / beforeSummary.median * 100,
  wins,
  losses: pairs.length - wins,
  byteIdentical,
  output: pairs[0] ? { before: pairs[0].beforeOutput, after: pairs[0].afterOutput } : undefined
};

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`paired ${options.phase} build comparison fixture=${fixture}`);
  console.log(`before median=${beforeSummary.median.toFixed(2)}ms mean=${beforeSummary.mean.toFixed(2)}ms`);
  console.log(`after median=${afterSummary.median.toFixed(2)}ms mean=${afterSummary.mean.toFixed(2)}ms`);
  console.log(`delta median=${deltas.median.toFixed(2)}ms mean=${deltas.mean.toFixed(2)}ms ratio=${result.medianRatioPercent.toFixed(2)}% wins=${wins}/${pairs.length}`);
  console.log(`byteIdentical=${byteIdentical}`);
}
