#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context, TreeContext } from '../packages/core/lib/index.js';
import { Parser } from '../packages/less-parser/lib/index.js';

function parseArgs(argv) {
  const options = {
    baseline: '0',
    candidate: '1',
    env: 'JESS_STATIC_NAMESPACE_TABLE',
    fixture: undefined,
    json: false,
    pairs: 60,
    phase: 'parse-render',
    warmup: 10
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--baseline':
        options.baseline = readValue(argv, ++i, arg);
        break;
      case '--candidate':
        options.candidate = readValue(argv, ++i, arg);
        break;
      case '--env':
        options.env = readValue(argv, ++i, arg);
        break;
      case '--fixture':
        options.fixture = readValue(argv, ++i, arg);
        break;
      case '--json':
        options.json = true;
        break;
      case '--pairs':
        options.pairs = readNumber(argv[++i], arg);
        break;
      case '--phase':
        options.phase = readValue(argv, ++i, arg);
        break;
      case '--warmup':
        options.warmup = readNumber(argv[++i], arg);
        break;
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }
  if (!options.fixture) {
    throw new Error('--fixture is required');
  }
  if (options.phase !== 'parse-render' && options.phase !== 'render') {
    throw new Error('--phase must be parse-render or render');
  }
  return options;
}

function readValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${name} must be a non-negative number`);
  }
  return Math.floor(number);
}

function resolveFixture(fixture) {
  if (path.isAbsolute(fixture)) {
    return fixture;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', fixture);
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const median = percentile(sorted, 0.5);
  const variance = values.length < 2
    ? 0
    : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return {
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    stddev: Math.sqrt(variance)
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function createContext(file) {
  const treeContext = new TreeContext({
    collapseNesting: true,
    file: {
      name: path.basename(file),
      path: path.dirname(file),
      fullPath: file
    }
  });
  const context = new Context({
    collapseNesting: true,
    file: treeContext.file
  });
  context.treeContext = treeContext;
  return context;
}

function parseFixture(parser, source, file, context) {
  const parsed = parser.parse(source, 'stylesheet', { context: context.treeContext });
  if (parsed.errors.length > 0 || !parsed.tree) {
    throw new Error(`Parse failed: ${parsed.errors.map(error => String(error)).join('; ')}`);
  }
  context.root = parsed.tree;
  return parsed.tree;
}

async function parseAndRender(parser, source, file, envName, envValue, phase) {
  process.env[envName] = envValue;
  const context = createContext(file);
  let start = performance.now();
  const tree = parseFixture(parser, source, file, context);
  if (phase === 'render') {
    start = performance.now();
  }
  await tree.render(context, { context, collapseNesting: true });
  return performance.now() - start;
}

const options = parseArgs(process.argv.slice(2));
const file = resolveFixture(options.fixture);
const source = fs.readFileSync(file, 'utf8');
const parser = new Parser();

for (let i = 0; i < options.warmup; i++) {
  await parseAndRender(parser, source, file, options.env, options.baseline, options.phase);
  await parseAndRender(parser, source, file, options.env, options.candidate, options.phase);
}

const pairs = [];
for (let i = 0; i < options.pairs; i++) {
  const candidateFirst = i % 2 === 1;
  let baselineMs;
  let candidateMs;
  if (candidateFirst) {
    candidateMs = await parseAndRender(parser, source, file, options.env, options.candidate, options.phase);
    baselineMs = await parseAndRender(parser, source, file, options.env, options.baseline, options.phase);
  } else {
    baselineMs = await parseAndRender(parser, source, file, options.env, options.baseline, options.phase);
    candidateMs = await parseAndRender(parser, source, file, options.env, options.candidate, options.phase);
  }
  pairs.push({
    index: i + 1,
    order: candidateFirst ? 'candidate-baseline' : 'baseline-candidate',
    baselineMs,
    candidateMs,
    deltaMs: candidateMs - baselineMs,
    ratio: baselineMs === 0 ? 0 : (candidateMs - baselineMs) / baselineMs
  });
}

const baseline = summarize(pairs.map(pair => pair.baselineMs));
const candidate = summarize(pairs.map(pair => pair.candidateMs));
const deltas = summarize(pairs.map(pair => pair.deltaMs));
const ratios = summarize(pairs.map(pair => pair.ratio));
const wins = pairs.filter(pair => pair.candidateMs < pair.baselineMs).length;
const standardError = deltas.stddev / Math.sqrt(pairs.length);
const result = {
  fixture: file,
  env: options.env,
  phase: options.phase,
  baselineValue: options.baseline,
  candidateValue: options.candidate,
  pairs: options.pairs,
  warmup: options.warmup,
  baseline,
  candidate,
  deltas,
  ratios,
  meanRatioPercent: ratios.mean * 100,
  medianRatioPercent: ratios.median * 100,
  wins,
  losses: pairs.length - wins,
  standardErrorMs: standardError,
  tStatistic: standardError === 0 ? 0 : deltas.mean / standardError,
  samples: pairs
};

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`paired ${options.phase} env comparison fixture=${file}`);
  console.log(`env=${options.env} baseline=${options.baseline} candidate=${options.candidate} pairs=${options.pairs}`);
  console.log(`baseline median=${baseline.median.toFixed(2)}ms mean=${baseline.mean.toFixed(2)}ms`);
  console.log(`candidate median=${candidate.median.toFixed(2)}ms mean=${candidate.mean.toFixed(2)}ms`);
  console.log(`delta median=${deltas.median.toFixed(2)}ms mean=${deltas.mean.toFixed(2)}ms t=${result.tStatistic.toFixed(2)}`);
  console.log(`ratio median=${result.medianRatioPercent.toFixed(2)}% mean=${result.meanRatioPercent.toFixed(2)}% wins=${wins}/${pairs.length}`);
}
