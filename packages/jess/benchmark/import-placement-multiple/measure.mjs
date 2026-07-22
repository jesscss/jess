#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context, StyleImport, createRenderBuffer, finalizeFlatRenderBuffer, getImportPlacementChildSegments } from '@jesscss/core';
import { Compiler } from '../../lib/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const root = path.dirname(fileURLToPath(import.meta.url));

function readInt(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} requires a positive integer`);
  }
  return value;
}

function readPhase() {
  const index = process.argv.indexOf('--phase');
  const phase = index === -1 ? 'parse-render' : process.argv[index + 1];
  if (phase !== 'parse-render' && phase !== 'render') {
    throw new TypeError('--phase must be parse-render or render');
  }
  return phase;
}

function percentile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
  const variance = samples.length < 2 ? 0 : samples.reduce((total, value) => total + (value - mean) ** 2, 0) / (samples.length - 1);
  const deviations = sorted.map(value => Math.abs(value - median)).sort((a, b) => a - b);
  return {
    samples: samples.length,
    medianMs: median,
    meanMs: mean,
    p25Ms: percentile(sorted, 0.25),
    p75Ms: percentile(sorted, 0.75),
    iqrMs: percentile(sorted, 0.75) - percentile(sorted, 0.25),
    madMs: percentile(deviations, 0.5),
    relativeStdDev: mean === 0 ? 0 : Math.sqrt(variance) / mean
  };
}

function makeOptions() {
  return {
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
  };
}

function makeContext() {
  return new Context({ output: { collapseNesting: true } }, [lessPlugin(), lessCompatPlugin()]);
}

async function parse(file, context) {
  const parsed = await context.getTree(file);
  if (!parsed.node) {
    throw new Error(`Parse failed: ${file}`);
  }
  context.root = parsed.node;
  return parsed.node;
}

async function renderParsed(file) {
  const context = makeContext();
  const tree = await parse(file, context);
  const buffer = createRenderBuffer('flat');
  buffer.shareWriter = true;
  const start = performance.now();
  await tree.render(context, buffer, { context, collapseNesting: true });
  finalizeFlatRenderBuffer(buffer);
  return performance.now() - start;
}

async function parseAndRender(file) {
  const compiler = new Compiler(makeOptions());
  const start = performance.now();
  await compiler.render(file);
  return performance.now() - start;
}

async function placementCounts(file) {
  const context = makeContext();
  const tree = await parse(file, context);
  context.treeContext = tree._treeContext;
  const imports = tree.rules.filter(node => node instanceof StyleImport);
  let retainedStates = 0;
  let retainedSegments = 0;
  for (const importNode of imports) {
    const result = await importNode.resolveForSpine(context);
    if (result.kind !== 'fold') {
      throw new Error('Expected folded import');
    }
    const segments = getImportPlacementChildSegments(result.body);
    if (segments) {
      retainedStates++;
      retainedSegments += segments.length;
    }
  }
  return {
    activations: imports.length,
    retainedStates,
    retainedArrays: retainedStates * 2,
    retainedSegmentRecords: retainedSegments
  };
}

const scale = readInt('--scale', 4);
const warmup = readInt('--warmup', 10);
const rounds = readInt('--rounds', 3);
const samplesPerRound = readInt('--samples', 15);
const phase = readPhase();
const file = path.join(root, `main-${scale}x.less`);
if (!fs.existsSync(file)) {
  throw new Error(`No fixture for ${scale}x: ${file}`);
}

const source = fs.readFileSync(file, 'utf8');
const less = (await import('less')).default;
const expected = await less.render(source, { filename: file });
const actual = await new Compiler(makeOptions()).render(file);
if (actual !== expected.css) {
  throw new Error(`Less byte mismatch for ${scale}x`);
}

const run = phase === 'parse-render' ? parseAndRender : renderParsed;
const allSamples = [];
const roundSummaries = [];
for (let round = 0; round < rounds; round++) {
  for (let index = 0; index < warmup; index++) {
    await run(file);
  }
  const samples = [];
  for (let index = 0; index < samplesPerRound; index++) {
    samples.push(await run(file));
  }
  allSamples.push(...samples);
  roundSummaries.push(summarize(samples));
}

console.log(JSON.stringify({
  fixture: path.basename(file),
  phase,
  warmupPerRound: warmup,
  rounds,
  samplesPerRound,
  parity: { lessBytes: Buffer.byteLength(expected.css), jessBytes: Buffer.byteLength(actual), exact: actual === expected.css },
  source: { bytes: fs.statSync(path.join(root, 'imp.less')).size, rules: 500, declarations: 2000 },
  placement: await placementCounts(file),
  summary: summarize(allSamples),
  roundMediansMs: roundSummaries.map(summary => summary.medianMs)
}, null, 2));
