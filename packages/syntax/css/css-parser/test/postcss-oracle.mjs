#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import { parse } from '../lib/index.js';

const fixtureRoot = path.join(import.meta.dirname, 'css');
const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const baselinePath = path.join(import.meta.dirname, 'postcss-oracle.baseline.json');
const writeBaseline = process.argv.includes('--write');
const runBench = process.argv.includes('--bench');
const singleArgIndex = process.argv.indexOf('--file');
const singleFile = singleArgIndex >= 0 ? process.argv[singleArgIndex + 1] : undefined;
const warmupsArgIndex = process.argv.indexOf('--warmups');
const iterationsArgIndex = process.argv.indexOf('--iterations');
const roundsArgIndex = process.argv.indexOf('--rounds');
const benchWarmupsOverride = warmupsArgIndex >= 0 ? Number(process.argv[warmupsArgIndex + 1]) : undefined;
const benchIterationsOverride = iterationsArgIndex >= 0 ? Number(process.argv[iterationsArgIndex + 1]) : undefined;
const benchRoundsOverride = roundsArgIndex >= 0 ? Number(process.argv[roundsArgIndex + 1]) : undefined;
let benchSink = 0;

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function listCssFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listCssFiles(full, rel));
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      out.push(rel);
    }
  }
  out.sort(compareStrings);
  return out;
}

function emptyFacts() {
  return { rules: 0, declarations: 0, atRules: 0 };
}

function collectJessFacts(value) {
  const facts = emptyFacts();
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child);
      }
      return;
    }
    if (typeof node !== 'object' || node === null) {
      return;
    }
    if (node.type === 'Rule') {
      facts.rules += 1;
    } else if (node.type === 'Declaration') {
      facts.declarations += 1;
    } else if (node.type === 'AtRuleBlock' || node.type === 'AtRuleStatement') {
      facts.atRules += 1;
    }
    for (const child of Object.values(node)) {
      visit(child);
    }
  };
  visit(value);
  return facts;
}

function collectPostcssFacts(root) {
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

function parseWithPostcss(source, from) {
  try {
    return { ok: true, facts: collectPostcssFacts(postcss.parse(source, { from })) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function sameFacts(left, right) {
  return left.rules === right.rules
    && left.declarations === right.declarations
    && left.atRules === right.atRules;
}

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([key, child]) => [key, stable(child)])
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function resolveInputFile(input) {
  if (path.isAbsolute(input)) {
    return input;
  }

  const fixtureCandidate = path.join(fixtureRoot, input);
  if (existsSync(fixtureCandidate)) {
    return fixtureCandidate;
  }

  return path.resolve(repoRoot, input);
}

function msOf(ns) {
  return (Number(ns) / 1_000_000).toFixed(2);
}

function usOf(ns) {
  return (Number(ns) / 1_000).toFixed(2);
}

function summarize(actual, files) {
  const acceptedByBoth = files.length
    - actual.acceptance.jessOnlyAccepted.length
    - actual.acceptance.postcssOnlyAccepted.length
    - actual.acceptance.rejectedByBoth.length;
  return [
    'CSS parser/PostCSS oracle',
    `fixtures: ${files.length}`,
    `accepted by both: ${acceptedByBoth}`,
    `rejected by both: ${actual.acceptance.rejectedByBoth.length}`,
    `Jess-only accepts: ${actual.acceptance.jessOnlyAccepted.length}`,
    `PostCSS-only accepts: ${actual.acceptance.postcssOnlyAccepted.length}`,
    `structural divergences: ${Object.keys(actual.structuralDivergences).length}`
  ].join('\n');
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
  const elapsed = process.hrtime.bigint() - start;
  return elapsed / BigInt(iterations);
}

function sortedBigints(values) {
  const sorted = [...values].sort((a, b) => Number(a - b));
  return sorted;
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
    { label: 'Jess parse-only', run: () => parse(source), samples: [] },
    { label: 'PostCSS parse-only', run: () => postcss.parse(source, { from }), samples: [] },
    { label: 'Jess parse+facts', run: () => collectJessFacts(parse(source)), samples: [] },
    { label: 'PostCSS parse+facts', run: () => collectPostcssFacts(postcss.parse(source, { from })), samples: [] }
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
    `CSS parser/PostCSS benchmark: ${fileLabel}`,
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

function assertBenchmarkable(fileLabel, source, from) {
  const jess = parseWithJess(source);
  const css = parseWithPostcss(source, from);
  if (jess.ok && css.ok) {
    return;
  }

  console.error(`Cannot benchmark ${fileLabel}: both parsers must accept the same input.`);
  if (!jess.ok) {
    console.error(`Jess rejected: ${jess.message}`);
  }
  if (!css.ok) {
    console.error(`PostCSS rejected: ${css.message}`);
  }
  process.exit(1);
}

const files = singleFile ? [singleFile] : await listCssFiles(fixtureRoot);
const acceptance = {
  jessOnlyAccepted: [],
  postcssOnlyAccepted: [],
  rejectedByBoth: []
};
const structuralDivergences = {};

for (const rel of files) {
  const full = resolveInputFile(rel);
  const source = await readFile(full, 'utf8');
  const jess = parseWithJess(source);
  const css = parseWithPostcss(source, full);

  if (jess.ok && !css.ok) {
    acceptance.jessOnlyAccepted.push(rel);
  } else if (!jess.ok && css.ok) {
    acceptance.postcssOnlyAccepted.push(rel);
  } else if (!jess.ok && !css.ok) {
    acceptance.rejectedByBoth.push(rel);
  } else if (jess.ok && css.ok && !sameFacts(jess.facts, css.facts)) {
    structuralDivergences[rel] = { jess: jess.facts, postcss: css.facts };
  }
}

const actual = { acceptance, structuralDivergences };

if (runBench) {
  if (files.length !== 1) {
    console.error('--bench requires exactly one --file input.');
    process.exit(2);
  }
  const full = resolveInputFile(files[0]);
  const source = await readFile(full, 'utf8');
  assertBenchmarkable(files[0], source, full);
  runBenchmark(files[0], source, full);
}

if (writeBaseline || singleFile) {
  console.log(summarize(actual, files));
  console.log(stableJson(actual));
  process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const actualJson = stableJson(actual);
const baselineJson = stableJson(baseline);

console.log(summarize(actual, files));

if (actualJson !== baselineJson) {
  console.error('\nPostCSS oracle changed. Run with --write and review the named-set diff.');
  console.error(actualJson);
  process.exit(1);
}
