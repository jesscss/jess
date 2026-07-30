#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import lessSyntax from 'postcss-less';
import { walkAuthoredAst } from '@jesscss/core/ast';
import { parse } from '../lib/index.js';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const defaultFile = 'packages/jess/benchmark/benchmark.less';
const runBench = process.argv.includes('--bench');
const singleArgIndex = process.argv.indexOf('--file');
const inputFile = singleArgIndex >= 0 ? process.argv[singleArgIndex + 1] : defaultFile;
const warmupsArgIndex = process.argv.indexOf('--warmups');
const iterationsArgIndex = process.argv.indexOf('--iterations');
const roundsArgIndex = process.argv.indexOf('--rounds');
const benchWarmupsOverride = warmupsArgIndex >= 0 ? Number(process.argv[warmupsArgIndex + 1]) : undefined;
const benchIterationsOverride = iterationsArgIndex >= 0 ? Number(process.argv[iterationsArgIndex + 1]) : undefined;
const benchRoundsOverride = roundsArgIndex >= 0 ? Number(process.argv[roundsArgIndex + 1]) : undefined;
let benchSink = 0;

function resolveInputFile(input) {
  if (path.isAbsolute(input)) {
    return input;
  }
  const repoCandidate = path.resolve(repoRoot, input);
  if (existsSync(repoCandidate)) {
    return repoCandidate;
  }
  return path.resolve(process.cwd(), input);
}

function emptyFacts() {
  return { rules: 0, declarations: 0, atRules: 0 };
}

function collectJessFacts(value) {
  const facts = emptyFacts();
  walkAuthoredAst(value, {
    enterNode(node) {
      if (node.type === 'Ruleset') {
        facts.rules += 1;
      } else if (node.type === 'Declaration') {
        facts.declarations += 1;
      } else if (node.type === 'AtRuleBlock' || node.type === 'AtRuleStatement') {
        facts.atRules += 1;
      }
    }
  });
  return facts;
}

function collectPostcssLessFacts(root) {
  const facts = emptyFacts();
  root.walkRules(() => {
    facts.rules += 1;
  });
  root.walkDecls(() => {
    facts.declarations += 1;
  });
  root.walkAtRules(() => {
    facts.atRules += 1;
  });
  return facts;
}

function parseWithJess(source) {
  try {
    return { ok: true, facts: collectJessFacts(parse(source)) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseWithPostcssLess(source, from) {
  try {
    return { ok: true, facts: collectPostcssLessFacts(lessSyntax.parse(source, { from })) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function validateBenchNumber(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    console.error(`${name} must be a non-negative integer`);
    process.exit(2);
  }
}

function consumeBenchValue(value) {
  if (value && typeof value === 'object') {
    if ('type' in value && typeof value.type === 'string') {
      benchSink += value.type.length;
    } else if ('nodes' in value && Array.isArray(value.nodes)) {
      benchSink += value.nodes.length;
    } else if ('rules' in value && typeof value.rules === 'number') {
      benchSink += value.rules;
    }
  }
}

function timedBatch(fn, iterations) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    consumeBenchValue(fn());
  }
  return (process.hrtime.bigint() - start) / BigInt(iterations);
}

function sortedBigints(values) {
  return [...values].sort((a, b) => Number(a - b));
}

function quantile(sorted, q) {
  if (sorted.length === 0) {
    return 0n;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[index] ?? 0n;
}

function summarizeSamples(samples) {
  const sorted = sortedBigints(samples);
  const meanNs = samples.length === 0
    ? 0n
    : samples.reduce((sum, value) => sum + value, 0n) / BigInt(samples.length);
  return {
    medianNs: quantile(sorted, 0.5),
    meanNs,
    p05Ns: quantile(sorted, 0.05),
    p95Ns: quantile(sorted, 0.95),
    minNs: sorted[0] ?? 0n,
    maxNs: sorted[sorted.length - 1] ?? 0n
  };
}

function warmCase(testCase, warmups) {
  for (let i = 0; i < warmups; i++) {
    consumeBenchValue(testCase.run());
  }
}

function maybeGc() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
}

function usOf(ns) {
  return (Number(ns) / 1_000).toFixed(2);
}

function formatBenchCase(result) {
  return `${result.label}: median ${usOf(result.stats.medianNs)}us/op, mean ${usOf(result.stats.meanNs)}us/op, p05 ${usOf(result.stats.p05Ns)}us/op, p95 ${usOf(result.stats.p95Ns)}us/op, min ${usOf(result.stats.minNs)}us/op, max ${usOf(result.stats.maxNs)}us/op`;
}

function defaultBenchConfig(sourceBytes) {
  if (sourceBytes >= 100_000) {
    return { warmups: 20, rounds: 15, iterations: 5 };
  }
  if (sourceBytes >= 10_000) {
    return { warmups: 100, rounds: 20, iterations: 50 };
  }
  return { warmups: 1000, rounds: 25, iterations: 5000 };
}

function assertBenchmarkable(fileLabel, source, from) {
  const jess = parseWithJess(source);
  const css = parseWithPostcssLess(source, from);
  if (jess.ok && css.ok) {
    console.log(`Less parser/PostCSS Less oracle: ${fileLabel}`);
    console.log(`Jess facts: ${JSON.stringify(jess.facts)}`);
    console.log(`PostCSS Less facts: ${JSON.stringify(css.facts)}`);
    return;
  }

  console.error(`Cannot benchmark ${fileLabel}: both parsers must accept the same input.`);
  if (!jess.ok) {
    console.error(`Jess Less parser rejected: ${jess.message}`);
  }
  if (!css.ok) {
    console.error(`PostCSS Less parser rejected: ${css.message}`);
  }
  process.exit(1);
}

function runBenchmark(fileLabel, source, from) {
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  const defaults = defaultBenchConfig(sourceBytes);
  const warmups = benchWarmupsOverride ?? defaults.warmups;
  const iterations = benchIterationsOverride ?? defaults.iterations;
  const rounds = benchRoundsOverride ?? defaults.rounds;

  validateBenchNumber('--warmups', warmups);
  validateBenchNumber('--iterations', iterations);
  validateBenchNumber('--rounds', rounds);
  if (iterations === 0) {
    console.error('--iterations must be greater than zero');
    process.exit(2);
  }
  if (rounds === 0) {
    console.error('--rounds must be greater than zero');
    process.exit(2);
  }

  const cases = [
    { label: 'Jess Less parse-only', run: () => parse(source), samples: [] },
    { label: 'PostCSS Less parse-only', run: () => lessSyntax.parse(source, { from }), samples: [] },
    { label: 'Jess Less parse+facts', run: () => collectJessFacts(parse(source)), samples: [] },
    { label: 'PostCSS Less parse+facts', run: () => collectPostcssLessFacts(lessSyntax.parse(source, { from })), samples: [] }
  ];

  for (const testCase of cases) {
    warmCase(testCase, warmups);
  }

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < cases.length; i++) {
      const testCase = cases[(round + i) % cases.length];
      maybeGc();
      testCase.samples.push(timedBatch(testCase.run, iterations));
    }
  }

  const results = cases.map(testCase => ({
    label: testCase.label,
    stats: summarizeSamples(testCase.samples)
  }));

  console.log([
    `source bytes: ${sourceBytes}`,
    `node: ${process.version}`,
    `warmups per case: ${warmups}`,
    `rounds: ${rounds}`,
    `iterations per round: ${iterations}`,
    'sample unit: elapsed batch time / iterations; file read and compatibility oracle are outside timed batches',
    `gc before each measured batch: ${typeof globalThis.gc === 'function' ? 'yes' : 'no'}`,
    ...results.map(formatBenchCase),
    `sink: ${benchSink}`
  ].join('\n'));
}

const full = resolveInputFile(inputFile);
const source = await readFile(full, 'utf8');
assertBenchmarkable(inputFile, source, full);
if (runBench) {
  runBenchmark(inputFile, source, full);
}
