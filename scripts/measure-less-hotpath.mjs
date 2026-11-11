#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Compiler } from '../packages/jess/lib/index.js';
import lessPlugin from '../packages/syntax/less/jess-plugin-less/lib/index.js';
import { lessCompatPlugin } from '../packages/syntax/less/jess-plugin-less-compat/lib/index.js';

const require = createRequire(import.meta.url);

const DEFAULT_FIXTURES = [
  'tests-unit/functions/functions.less',
  'tests-unit/import/import-reference.less',
  'tests-unit/mixins-guards/mixins-guards.less',
  'tests-unit/extend-chaining/extend-chaining.less',
  'tests-unit/media/media.less'
];

/** `bootstrap4` names the less.js corpus file, set up as the corpus renders it (`prepareVsLesscFixture`). */
const VS_LESSC_FIXTURES = [
  'packages/jess/benchmark/benchmark.less',
  'bootstrap4'
];

const DEFAULT_HISTORY_FILE = 'docs/perf/node-copy-reduction/less-hotpath-history.jsonl';
const DEFAULT_THRESHOLD = 0.08;
const DEFAULT_STABLE_ITERATIONS = 100;
const DEFAULT_STABLE_REPEAT = 5;
const DEFAULT_STABLE_TRIM = 0.1;
const DEFAULT_STABLE_WARMUP = 20;

function parseArgs(argv) {
  const options = {
    batchSize: 1,
    collapseNesting: true,
    compare: undefined,
    compareLatest: false,
    fixtures: [],
    historyFile: DEFAULT_HISTORY_FILE,
    iterations: 30,
    json: false,
    jsonl: false,
    n1: 5,
    n2: 20,
    note: '',
    repeat: undefined,
    save: false,
    threshold: DEFAULT_THRESHOLD,
    trim: 0,
    vsLessc: false,
    warmup: undefined
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case '--batch-size':
        options.batchSize = readNumber(readValue(argv, ++i, arg), arg);
        break;
      case '--compare':
        options.compare = readValue(argv, ++i, arg);
        break;
      case '--compare-latest':
        options.compareLatest = true;
        break;
      case '--collapse-nesting':
        options.collapseNesting = readBoolean(readValue(argv, ++i, arg), arg);
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
      case '--n1':
        options.n1 = readNumber(readValue(argv, ++i, arg), arg);
        break;
      case '--n2':
        options.n2 = readNumber(readValue(argv, ++i, arg), arg);
        break;
      case '--note':
        options.note = readValue(argv, ++i, arg);
        break;
      case '--repeat':
        options.repeat = readNumber(readValue(argv, ++i, arg), arg);
        break;
      case '--save':
        options.save = true;
        break;
      case '--stable':
        options.iterations = DEFAULT_STABLE_ITERATIONS;
        options.repeat = DEFAULT_STABLE_REPEAT;
        options.trim = DEFAULT_STABLE_TRIM;
        options.warmup = DEFAULT_STABLE_WARMUP;
        break;
      case '--threshold':
        options.threshold = readFloat(readValue(argv, ++i, arg), arg);
        break;
      case '--trim':
        options.trim = readFloat(readValue(argv, ++i, arg), arg);
        break;
      case '--vs-lessc':
        options.vsLessc = true;
        break;
      case '--warmup':
        options.warmup = readNumber(readValue(argv, ++i, arg), arg);
        break;
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }

  options.repeat ??= options.vsLessc ? 7 : 1;
  options.warmup ??= options.vsLessc ? 10 : 3;
  if (options.fixtures.length === 0) {
    options.fixtures = options.vsLessc ? VS_LESSC_FIXTURES : DEFAULT_FIXTURES;
  }
  if (options.n2 <= options.n1) {
    throw new TypeError('--n2 must be greater than --n1');
  }
  if (options.iterations < 1) {
    throw new TypeError('--iterations must be greater than zero');
  }
  if (options.batchSize < 1) {
    throw new TypeError('--batch-size must be greater than zero');
  }
  if (options.repeat < 1) {
    throw new TypeError('--repeat must be greater than zero');
  }
  if (options.trim < 0 || options.trim >= 0.5) {
    throw new TypeError('--trim must be greater than or equal to 0 and less than 0.5');
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

function readBoolean(value, name) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new TypeError(`${name} must be true or false`);
}

function summarize(times, trimRatio = 0) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const median = percentile(sorted, 0.5);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  const iqr = p75 - p25;
  const trimmed = trimValues(sorted, trimRatio);
  const trimmedMean = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
  const trimmedMedian = percentile(trimmed, 0.5);
  const trimmedRelativeStdDev = relativeStdDev(trimmed, trimmedMean);
  const deviations = sorted.map(value => Math.abs(value - median)).sort((a, b) => a - b);
  return {
    samples: sorted.length,
    median,
    mean,
    min: sorted[0],
    max: sorted.at(-1),
    p25,
    p75,
    p90: percentile(sorted, 0.9),
    relativeStdDev: relativeStdDev(sorted, mean),
    mad: percentile(deviations, 0.5),
    iqr,
    outliers: countOutliers(sorted, p25, p75),
    trimRatio,
    trimmedMean,
    trimmedMedian,
    trimmedRelativeStdDev,
    trimDroppedEachSide: Math.floor(sorted.length * trimRatio)
  };
}

function summarizeRounds(rounds, trimRatio) {
  const allTimes = [];
  const roundMedians = [];
  for (const round of rounds) {
    for (const time of round.times) {
      allTimes.push(time);
    }
    roundMedians.push(round.summary.trimmedMedian);
  }
  const sampleSummary = summarize(allTimes, trimRatio);
  const sortedRoundMedians = [...roundMedians].sort((a, b) => a - b);
  const roundMedian = percentile(sortedRoundMedians, 0.5);
  const roundMean = sortedRoundMedians.reduce((sum, value) => sum + value, 0) / sortedRoundMedians.length;
  const roundRelativeStdDev = relativeStdDev(sortedRoundMedians, roundMean);
  const signalQuality = classifySignal(sampleSummary, roundRelativeStdDev);
  return {
    ...sampleSummary,
    median: roundMedian,
    mean: roundMean,
    sampleMedian: sampleSummary.median,
    sampleMean: sampleSummary.mean,
    roundMedian,
    roundMean,
    roundRelativeStdDev,
    rounds: rounds.length,
    signalQuality
  };
}

function trimValues(sorted, trimRatio) {
  const trim = Math.floor(sorted.length * trimRatio);
  if (trim === 0) {
    return sorted;
  }
  return sorted.slice(trim, sorted.length - trim);
}

function countOutliers(sorted, p25, p75) {
  const iqr = p75 - p25;
  if (iqr === 0) {
    return 0;
  }
  const low = p25 - iqr * 1.5;
  const high = p75 + iqr * 1.5;
  let count = 0;
  for (const value of sorted) {
    if (value < low || value > high) {
      count++;
    }
  }
  return count;
}

function classifySignal(summary, roundRelativeStdDev) {
  const outlierRate = summary.samples === 0 ? 0 : summary.outliers / summary.samples;
  if (summary.trimmedRelativeStdDev <= 0.15 && outlierRate <= 0.1 && roundRelativeStdDev <= 0.08) {
    return 'usable';
  }
  if (summary.trimmedRelativeStdDev <= 0.25 && outlierRate <= 0.2 && roundRelativeStdDev <= 0.15) {
    return 'unstable';
  }
  return 'noisy';
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

function getGitCommit(cwd) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return undefined;
  }
}

function getGitTopLevel(cwd) {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return fs.realpathSync(root);
  } catch {
    return undefined;
  }
}

function packageVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

function makeRunMeta(options, testData) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return {
    type: 'less-hotpath-run',
    timestamp: new Date().toISOString(),
    commit: getGitCommit(path.resolve(scriptDir, '..')),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    iterations: options.iterations,
    repeat: options.repeat,
    trim: options.trim,
    warmup: options.warmup,
    batchSize: options.batchSize,
    collapseNesting: options.collapseNesting,
    testDataRoot: testData.root,
    testDataVersion: testData.version,
    testDataCommit: testData.commit,
    note: options.note || undefined
  };
}

function toRecord(run, fixture, result, times, rounds) {
  return {
    type: 'less-hotpath-fixture',
    timestamp: run.timestamp,
    commit: run.commit,
    node: run.node,
    platform: run.platform,
    arch: run.arch,
    fixture,
    iterations: run.iterations,
    repeat: run.repeat,
    trim: run.trim,
    warmup: run.warmup,
    batchSize: run.batchSize,
    collapseNesting: run.collapseNesting,
    testDataRoot: run.testDataRoot,
    testDataVersion: run.testDataVersion,
    testDataCommit: run.testDataCommit,
    note: run.note,
    summary: result,
    times,
    rounds
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
    latest.set(recordKey(record), record);
  }
  return latest;
}

function recordKey(record) {
  return `${record.fixture}\0${record.collapseNesting ?? true}`;
}

function compareRecords(currentRecords, baselineRecords, threshold) {
  const baselineByFixture = latestHistoryByFixture(baselineRecords);
  return currentRecords.map((record) => {
    const baseline = baselineByFixture.get(recordKey(record));
    if (!baseline) {
      return {
        fixture: record.fixture,
        collapseNesting: record.collapseNesting,
        status: 'missing-baseline'
      };
    }
    const identityFields = ['testDataRoot', 'testDataVersion', 'testDataCommit'];
    const mismatchedIdentity = identityFields.find(field =>
      baseline[field] !== undefined && baseline[field] !== record[field]);
    if (mismatchedIdentity !== undefined) {
      return {
        fixture: record.fixture,
        collapseNesting: record.collapseNesting,
        baselineCommit: baseline.commit,
        status: 'corpus-mismatch',
        mismatchedIdentity,
        baselineValue: baseline[mismatchedIdentity],
        currentValue: record[mismatchedIdentity]
      };
    }
    const baselineMedian = baseline.summary.median;
    const currentMedian = record.summary.median;
    const delta = currentMedian - baselineMedian;
    const ratio = baselineMedian === 0 ? 0 : delta / baselineMedian;
    const baselineSignalQuality = baseline.summary.signalQuality;
    const currentSignalQuality = record.summary.signalQuality;
    const status = compareStatus(ratio, threshold, baselineSignalQuality, currentSignalQuality);
    return {
      fixture: record.fixture,
      collapseNesting: record.collapseNesting,
      baselineCommit: baseline.commit,
      baselineMedian,
      currentMedian,
      delta,
      ratio,
      status
    };
  });
}

function compareStatus(ratio, threshold, baselineSignalQuality, currentSignalQuality) {
  if (baselineSignalQuality === 'noisy') {
    return 'noisy-baseline';
  }
  if (currentSignalQuality === 'noisy') {
    return 'noisy-signal';
  }
  if (currentSignalQuality === 'unstable') {
    return 'unstable-signal';
  }
  if (Math.abs(ratio) < threshold) {
    return 'noise';
  }
  return ratio < 0 ? 'faster' : 'slower';
}

function writeHistory(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

/**
 * `--vs-lessc`: jess against lessc 4.x in one process, per fixture.
 *
 * - parse: jess `Compiler.compile` (parse plus static imports) against
 *   `less.parse` (parse plus imports). total: `Compiler.render` against
 *   `less.render`. eval+render is total minus parse, per round.
 * - Each value is the marginal time per compile after warm-up,
 *   (T(n2) − T(n1)) / (n2 − n1), so per-batch overhead cancels.
 * - Every round times each metric on three arms, jess, lessc and jess again
 *   (the A/A arm), in an order that reverses each round. A row reports the
 *   median of the rounds and their range; the ratio is the median of the
 *   per-round ratios.
 * - idle is the share of the timed n2 batch the event loop spent idle
 *   (`performance.eventLoopUtilization`), which is where a render waits on a
 *   worker process, such as the Deno sandbox that runs Less `@plugin` scripts.
 */
async function measureVsLessc(compiler, options, testDataRoot) {
  const { default: less } = await import('less');
  const arms = ['jess', 'lessc', 'jess A/A'];
  const metrics = ['parse', 'total'];
  const loadBefore = os.loadavg();
  const fixtureResults = [];
  for (const rel of options.fixtures) {
    const fixture = prepareVsLesscFixture(rel, testDataRoot);
    try {
      const lessOptions = { filename: fixture.file, ...fixture.lessOptions };
      const jessOptions = { suppressWarnings: true };
      const ops = {
        jess: {
          parse: () => compiler.compile(fixture.file, jessOptions),
          total: () => compiler.render(fixture.file, jessOptions)
        },
        lessc: {
          parse: () => less.parse(fs.readFileSync(fixture.file, 'utf8'), lessOptions),
          total: () => less.render(fs.readFileSync(fixture.file, 'utf8'), lessOptions).then(output => output.css)
        }
      };
      ops['jess A/A'] = ops.jess;

      const outputBytes = {
        jess: (await ops.jess.total()).length,
        lessc: (await ops.lessc.total()).length
      };
      for (let i = 0; i < options.warmup; i++) {
        for (const arm of ['jess', 'lessc']) {
          for (const metric of metrics) {
            await ops[arm][metric]();
          }
        }
      }

      const samples = Object.fromEntries(arms.map(arm => [arm, { parse: [], total: [], evalRender: [], idle: [] }]));
      for (let round = 0; round < options.repeat; round++) {
        const order = round % 2 === 0 ? arms : [...arms].reverse();
        for (const metric of metrics) {
          for (const arm of order) {
            const { ms, idle } = await marginalPerCompile(ops[arm][metric], options.n1, options.n2);
            samples[arm][metric].push(ms);
            if (metric === 'total') {
              samples[arm].idle.push(idle);
            }
          }
        }
        for (const arm of arms) {
          samples[arm].evalRender.push(samples[arm].total[round] - samples[arm].parse[round]);
        }
      }
      fixtureResults.push({ fixture: fixture.name, outputBytes, samples });
    } finally {
      fixture.cleanup();
    }
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const run = {
    type: 'less-vs-lessc-run',
    timestamp: new Date().toISOString(),
    commit: getGitCommit(path.resolve(scriptDir, '..')),
    node: process.version,
    lessc: less.version.join('.'),
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    cpus: os.cpus().length,
    loadavg: { before: loadBefore, after: os.loadavg() },
    n1: options.n1,
    n2: options.n2,
    rounds: options.repeat,
    warmup: options.warmup,
    collapseNesting: options.collapseNesting,
    note: options.note || undefined
  };
  compiler.dispose();

  if (options.json) {
    console.log(JSON.stringify({ run, fixtures: fixtureResults }, null, 2));
    return;
  }
  const cell = values => `${formatMs(median(values))} (${formatMs(Math.min(...values))}–${formatMs(Math.max(...values))})`;
  const ratio = (values, base) => {
    const ratios = values.map((value, i) => value / base[i]);
    return `${median(ratios).toFixed(2)}× (${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)})`;
  };
  console.log(`jess vs lessc ${run.lessc}: marginal ms per compile, n ${run.n1} → ${run.n2}, median of ${run.rounds} rounds (range), ${run.warmup} warm-up compiles, collapseNesting=${run.collapseNesting}`);
  console.log(`commit=${run.commit ?? 'unknown'} node=${run.node} ${run.platform}/${run.arch} ${run.cpu} ×${run.cpus} loadavg=${run.loadavg.before.map(load => load.toFixed(2)).join('/')} → ${run.loadavg.after.map(load => load.toFixed(2)).join('/')}`);
  console.log('');
  console.log('| Fixture | Metric | jess | lessc | jess / lessc | A/A (jess / jess) |');
  console.log('|---|---|---|---|---|---|');
  for (const { fixture, samples } of fixtureResults) {
    for (const [metric, label] of [['parse', 'parse'], ['evalRender', 'eval+render'], ['total', 'total']]) {
      console.log(`| \`${fixture}\` | ${label} | ${cell(samples.jess[metric])} | ${cell(samples.lessc[metric])} | ${ratio(samples.jess[metric], samples.lessc[metric])} | ${ratio(samples['jess A/A'][metric], samples.jess[metric])} |`);
    }
  }
  console.log('');
  for (const { fixture, outputBytes, samples } of fixtureResults) {
    console.log(`${fixture}: event loop idle during total, jess ${formatPercent(median(samples.jess.idle))}, lessc ${formatPercent(median(samples.lessc.idle))}; output bytes jess ${outputBytes.jess}, lessc ${outputBytes.lessc}`);
  }
}

async function marginalPerCompile(op, n1, n2) {
  const first = await timeCompiles(op, n1);
  const before = performance.eventLoopUtilization();
  const second = await timeCompiles(op, n2);
  const { idle, active } = performance.eventLoopUtilization(before);
  return { ms: (second - first) / (n2 - n1), idle: idle / (idle + active) };
}

async function timeCompiles(op, count) {
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    await op();
  }
  return performance.now() - start;
}

function median(values) {
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

/**
 * `bootstrap4` is the less.js corpus `bootstrap4.less` set up as the corpus
 * renders it, as `measure-cli-cold-start.mjs` does: its `styles.config.cjs`
 * (`math: 0`) beside it, `bootstrap-less-port` from
 * `packages/less-corpus-fixture-deps`; lessc gets `math: 'always'` and that
 * package as an include path, so both compile the same sources. Any other
 * fixture resolves as in the hot-path mode, with lessc's default options.
 */
function prepareVsLesscFixture(rel, testDataRoot) {
  if (rel !== 'bootstrap4') {
    return { name: rel, file: resolveFixturePath(testDataRoot, rel), lessOptions: {}, cleanup() {} };
  }
  const corpus = path.join(testDataRoot, 'tests-config/3rd-party');
  const deps = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/less-corpus-fixture-deps/node_modules');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-vs-lessc-'));
  fs.copyFileSync(path.join(corpus, 'bootstrap4.less'), path.join(scratch, 'bootstrap4.less'));
  fs.copyFileSync(path.join(corpus, 'styles.config.cjs'), path.join(scratch, 'styles.config.cjs'));
  fs.writeFileSync(path.join(scratch, 'package.json'), '{"private":true}\n');
  fs.symlinkSync(deps, path.join(scratch, 'node_modules'));
  return {
    name: 'bootstrap4.less',
    file: path.join(scratch, 'bootstrap4.less'),
    lessOptions: { math: 'always', paths: [deps] },
    cleanup: () => fs.rmSync(scratch, { recursive: true, force: true })
  };
}

const options = parseArgs(process.argv.slice(2));
const fixtures = options.fixtures;
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDataRoot = fs.realpathSync(process.env.JESS_LESS_TEST_DATA_ROOT
  ?? path.dirname(require.resolve('@less/test-data')));
const sourceGitRoot = getGitTopLevel(sourceRoot);
const testDataGitRoot = getGitTopLevel(testDataRoot);
const run = makeRunMeta(options, {
  root: testDataRoot,
  version: packageVersion(testDataRoot),
  commit: testDataGitRoot !== undefined && testDataGitRoot !== sourceGitRoot
    ? getGitCommit(testDataGitRoot)
    : undefined
});

const compiler = new Compiler({
  output: {
    collapseNesting: options.collapseNesting
  },
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin()
    ]
  }
});

if (options.vsLessc) {
  await measureVsLessc(compiler, options, testDataRoot);
} else {
  const records = [];
  for (const rel of fixtures) {
    const file = resolveFixturePath(testDataRoot, rel);
    const rounds = [];
    for (let round = 0; round < options.repeat; round++) {
      for (let i = 0; i < options.warmup; i++) {
        await compiler.render(file);
      }
      const times = [];
      for (let i = 0; i < options.iterations; i++) {
        const start = performance.now();
        for (let batch = 0; batch < options.batchSize; batch++) {
          await compiler.render(file);
        }
        times.push(performance.now() - start);
      }
      rounds.push({
        index: round + 1,
        summary: summarize(times, options.trim),
        times
      });
    }
    const result = summarizeRounds(rounds, options.trim);
    const times = rounds.flatMap(round => round.times);
    records.push(toRecord(run, rel, result, times, rounds));
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
    console.log(`Less hot-path measurement (${options.iterations} iterations, ${options.warmup} warmup, ${options.repeat} repeat, batch ${options.batchSize}, ${formatPercent(options.trim)} trim, collapseNesting=${options.collapseNesting})`);
    console.log(`commit=${run.commit ?? 'unknown'} node=${run.node} platform=${run.platform}/${run.arch}`);
    console.log(`testDataRoot=${run.testDataRoot} testDataVersion=${run.testDataVersion ?? 'unknown'} testDataCommit=${run.testDataCommit ?? 'unknown'}`);
    for (const record of records) {
      const result = record.summary;
      console.log(`${record.fixture}`);
      console.log(`  signal=${result.signalQuality} median=${formatMs(result.median)} mean=${formatMs(result.mean)} sampleMedian=${formatMs(result.sampleMedian)} trimmedMedian=${formatMs(result.trimmedMedian)} p75=${formatMs(result.p75)} p90=${formatMs(result.p90)} min=${formatMs(result.min)} max=${formatMs(result.max)} rsd=${formatPercent(result.relativeStdDev)} roundRsd=${formatPercent(result.roundRelativeStdDev)} outliers=${result.outliers}/${result.samples}`);
      console.log(`  trimmedMean=${formatMs(result.trimmedMean)} trimmedRsd=${formatPercent(result.trimmedRelativeStdDev)} mad=${formatMs(result.mad)} iqr=${formatMs(result.iqr)}`);
      const compared = comparison.find(item => item.fixture === record.fixture
        && item.collapseNesting === record.collapseNesting);
      if (compared?.status === 'corpus-mismatch') {
        console.log(`  corpus mismatch: ${compared.mismatchedIdentity} baseline=${compared.baselineValue} current=${compared.currentValue}`);
      } else if (compared && compared.status !== 'missing-baseline') {
        console.log(`  vs ${compared.baselineCommit?.slice(0, 8) ?? 'baseline'}: ${formatMs(compared.delta)} (${formatPercent(compared.ratio)}) ${compared.status}`);
      }
    }
    if (options.save) {
      console.log(`saved=${options.historyFile}`);
    }
  }
}

function resolveFixturePath(testDataRoot, fixture) {
  if (path.isAbsolute(fixture)) {
    return fixture;
  }
  const repoFixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', fixture);
  if (fs.existsSync(repoFixture)) {
    return repoFixture;
  }
  return path.join(testDataRoot, fixture);
}
