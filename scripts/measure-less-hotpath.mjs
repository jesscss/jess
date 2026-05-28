#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const DEFAULT_HISTORY_FILE = 'docs/future/node-copy-reduction/less-hotpath-history.jsonl';
const DEFAULT_THRESHOLD = 0.08;

function parseArgs(argv) {
  const options = {
    compare: undefined,
    compareLatest: false,
    fixtures: [],
    historyFile: DEFAULT_HISTORY_FILE,
    iterations: 30,
    json: false,
    jsonl: false,
    note: '',
    save: false,
    threshold: DEFAULT_THRESHOLD,
    warmup: 3
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case '--compare':
        options.compare = readValue(argv, ++i, arg);
        break;
      case '--compare-latest':
        options.compareLatest = true;
        break;
      case '--fixture':
        options.fixtures.push(readValue(argv, ++i, arg));
        break;
      case '--history':
        options.historyFile = readValue(argv, ++i, arg);
        break;
      case '--iterations':
        options.iterations = readNumber(readValue(argv, ++i, arg), arg);
        break;
      case '--json':
        options.json = true;
        break;
      case '--jsonl':
        options.jsonl = true;
        break;
      case '--note':
        options.note = readValue(argv, ++i, arg);
        break;
      case '--save':
        options.save = true;
        break;
      case '--threshold':
        options.threshold = readFloat(readValue(argv, ++i, arg), arg);
        break;
      case '--warmup':
        options.warmup = readNumber(readValue(argv, ++i, arg), arg);
        break;
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }

  if (options.fixtures.length === 0) {
    options.fixtures = DEFAULT_FIXTURES;
  }
  if (options.iterations < 1) {
    throw new TypeError('--iterations must be greater than zero');
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

function readFloat(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${name} must be a non-negative number`);
  }
  return number;
}

function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const median = percentile(sorted, 0.5);
  return {
    median,
    mean,
    min: sorted[0],
    max: sorted.at(-1),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    relativeStdDev: relativeStdDev(sorted, mean)
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

function relativeStdDev(values, mean) {
  if (values.length < 2 || mean === 0) {
    return 0;
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / mean;
}

function formatMs(value) {
  return `${value.toFixed(2)}ms`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function getGitCommit() {
  try {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(scriptDir, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return undefined;
  }
}

function makeRunMeta(options) {
  return {
    type: 'less-hotpath-run',
    timestamp: new Date().toISOString(),
    commit: getGitCommit(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    iterations: options.iterations,
    warmup: options.warmup,
    note: options.note || undefined
  };
}

function toRecord(run, fixture, result, times) {
  return {
    type: 'less-hotpath-fixture',
    timestamp: run.timestamp,
    commit: run.commit,
    node: run.node,
    platform: run.platform,
    arch: run.arch,
    fixture,
    iterations: run.iterations,
    warmup: run.warmup,
    note: run.note,
    summary: result,
    times
  };
}

function readHistory(file) {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(record => record.type === 'less-hotpath-fixture');
}

function latestHistoryByFixture(records) {
  const latest = new Map();
  for (const record of records) {
    latest.set(record.fixture, record);
  }
  return latest;
}

function compareRecords(currentRecords, baselineRecords, threshold) {
  const baselineByFixture = latestHistoryByFixture(baselineRecords);
  return currentRecords.map(record => {
    const baseline = baselineByFixture.get(record.fixture);
    if (!baseline) {
      return { fixture: record.fixture, status: 'missing-baseline' };
    }
    const baselineMedian = baseline.summary.median;
    const currentMedian = record.summary.median;
    const delta = currentMedian - baselineMedian;
    const ratio = baselineMedian === 0 ? 0 : delta / baselineMedian;
    const status = Math.abs(ratio) < threshold
      ? 'noise'
      : ratio < 0
        ? 'faster'
        : 'slower';
    return {
      fixture: record.fixture,
      baselineCommit: baseline.commit,
      baselineMedian,
      currentMedian,
      delta,
      ratio,
      status
    };
  });
}

function writeHistory(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

const options = parseArgs(process.argv.slice(2));
const fixtures = options.fixtures;
const testDataRoot = path.dirname(require.resolve('@less/test-data'));
const run = makeRunMeta(options);

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

const records = [];
for (const rel of fixtures) {
  const file = path.join(testDataRoot, rel);
  for (let i = 0; i < options.warmup; i++) {
    await compiler.render(file);
  }
  const times = [];
  for (let i = 0; i < options.iterations; i++) {
    const start = performance.now();
    await compiler.render(file);
    times.push(performance.now() - start);
  }
  const result = summarize(times);
  records.push(toRecord(run, rel, result, times));
}

let comparison = [];
const compareFile = options.compare ?? (options.compareLatest ? options.historyFile : undefined);
if (compareFile) {
  comparison = compareRecords(records, readHistory(compareFile), options.threshold);
}

if (options.save) {
  writeHistory(options.historyFile, records);
}

if (options.json) {
  console.log(JSON.stringify({ run, records, comparison }, null, 2));
} else if (options.jsonl) {
  for (const record of records) {
    console.log(JSON.stringify(record));
  }
} else {
  console.log(`Less hot-path measurement (${options.iterations} iterations, ${options.warmup} warmup)`);
  console.log(`commit=${run.commit ?? 'unknown'} node=${run.node} platform=${run.platform}/${run.arch}`);
  for (const record of records) {
    const result = record.summary;
    console.log(`${record.fixture}`);
    console.log(
      `  median=${formatMs(result.median)} mean=${formatMs(result.mean)} p75=${formatMs(result.p75)} p90=${formatMs(result.p90)} min=${formatMs(result.min)} max=${formatMs(result.max)} rsd=${formatPercent(result.relativeStdDev)}`
    );
    const compared = comparison.find(item => item.fixture === record.fixture);
    if (compared && compared.status !== 'missing-baseline') {
      console.log(
        `  vs ${compared.baselineCommit?.slice(0, 8) ?? 'baseline'}: ${formatMs(compared.delta)} (${formatPercent(compared.ratio)}) ${compared.status}`
      );
    }
  }
  if (options.save) {
    console.log(`saved=${options.historyFile}`);
  }
}
