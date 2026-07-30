#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import lessSyntax from 'postcss-less';
import scssSyntax from 'postcss-scss';
import stylelint from 'stylelint';
import {
  STYLELINT_COMPARISON_LINT_CONFIG,
  lintText
} from '../lib/index.js';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const defaultFile = 'packages/jess/benchmark/benchmark.css';
const singleArgIndex = process.argv.indexOf('--file');
const inputFile = singleArgIndex >= 0 ? process.argv[singleArgIndex + 1] : defaultFile;
const warmupsArgIndex = process.argv.indexOf('--warmups');
const iterationsArgIndex = process.argv.indexOf('--iterations');
const roundsArgIndex = process.argv.indexOf('--rounds');
const benchWarmupsOverride = warmupsArgIndex >= 0 ? Number(process.argv[warmupsArgIndex + 1]) : undefined;
const benchIterationsOverride = iterationsArgIndex >= 0 ? Number(process.argv[iterationsArgIndex + 1]) : undefined;
const benchRoundsOverride = roundsArgIndex >= 0 ? Number(process.argv[roundsArgIndex + 1]) : undefined;
let benchSink = 0;

const STYLELINT_RULES = {
  'block-no-empty': true,
  'property-no-unknown': true,
  'at-rule-no-unknown': true,
  'at-rule-descriptor-no-unknown': true,
  'declaration-block-no-duplicate-custom-properties': true,
  'declaration-block-no-duplicate-properties': true,
  'declaration-block-no-shorthand-property-overrides': true,
  'color-no-invalid-hex': true,
  'length-zero-no-unit': true,
  'custom-property-no-missing-var-function': true,
  'keyframe-block-no-duplicate-selectors': true,
  'keyframe-declaration-no-important': true,
  'declaration-no-important': true,
  'named-grid-areas-no-invalid': true,
  'font-family-no-duplicate-names': true,
  'font-family-no-missing-generic-family-keyword': true,
  'no-invalid-position-at-import-rule': true,
  'no-duplicate-at-import-rules': true,
  'unit-no-unknown': true,
  'function-no-unknown': true,
  'media-feature-name-no-unknown': true,
  'media-feature-name-value-no-unknown': true,
  'selector-pseudo-class-no-unknown': true,
  'selector-pseudo-element-no-unknown': true,
  'selector-anb-no-unmatchable': true,
  'selector-type-no-unknown': true
};

const STYLELINT_LESS_RULES = {
  ...STYLELINT_RULES,
  'at-rule-no-unknown': [true, { ignoreAtRules: ['plugin'] }]
};

const STYLELINT_SCSS_RULES = {
  ...STYLELINT_RULES,
  'at-rule-no-unknown': [true, {
    ignoreAtRules: [
      'at-root',
      'content',
      'debug',
      'each',
      'else',
      'error',
      'extend',
      'for',
      'forward',
      'function',
      'if',
      'include',
      'mixin',
      'return',
      'use',
      'warn',
      'while'
    ]
  }]
};

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

function languageFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.less') {
    return 'less';
  }
  if (extension === '.scss') {
    return 'scss';
  }
  return 'css';
}

function validateBenchNumber(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    console.error(`${name} must be a non-negative integer`);
    process.exit(2);
  }
}

function consumeBenchValue(value) {
  if (value && typeof value === 'object') {
    if ('diagnostics' in value && Array.isArray(value.diagnostics)) {
      benchSink += value.diagnostics.length;
    } else if ('results' in value && Array.isArray(value.results)) {
      const first = value.results[0];
      benchSink += Array.isArray(first?.warnings) ? first.warnings.length : value.results.length;
    }
  }
}

async function timedBatch(fn, iterations) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    consumeBenchValue(await fn());
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

async function warmCase(testCase, warmups) {
  for (let i = 0; i < warmups; i++) {
    consumeBenchValue(await testCase.run());
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
    return { warmups: 5, rounds: 10, iterations: 3 };
  }
  if (sourceBytes >= 10_000) {
    return { warmups: 20, rounds: 15, iterations: 10 };
  }
  return { warmups: 100, rounds: 20, iterations: 100 };
}

function stylelintOptions(source, filePath, language) {
  const options = {
    code: source,
    codeFilename: filePath,
    disableDefaultIgnores: true,
    config: {
      rules: language === 'less'
        ? STYLELINT_LESS_RULES
        : language === 'scss'
          ? STYLELINT_SCSS_RULES
          : STYLELINT_RULES
    }
  };
  if (language === 'less') {
    return {
      ...options,
      customSyntax: lessSyntax
    };
  }
  if (language === 'scss') {
    return {
      ...options,
      customSyntax: scssSyntax
    };
  }
  return options;
}

async function runJessLint(source, filePath, language) {
  return await lintText(
    { source, filePath, language },
    {
      cwd: repoRoot,
      stylesConfig: { lint: STYLELINT_COMPARISON_LINT_CONFIG }
    }
  );
}

async function runStylelint(source, filePath, language) {
  return await stylelint.lint(stylelintOptions(source, filePath, language));
}

async function assertBenchmarkable(fileLabel, source, filePath, language) {
  const jess = await runJessLint(source, filePath, language);
  const stylelintResult = await runStylelint(source, filePath, language);
  const stylelintWarnings = stylelintResult.results.reduce(
    (sum, result) => sum + result.warnings.length,
    0
  );
  console.log(`Jess lint/Stylelint benchmark: ${fileLabel}`);
  console.log(`language: ${language}`);
  console.log(`Jess lint diagnostics: ${jess.diagnostics.length}`);
  console.log(`Stylelint warnings: ${stylelintWarnings}`);
}

async function runBenchmark(source, filePath, language) {
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
    { label: 'Jess lint comparison config', run: () => runJessLint(source, filePath, language), samples: [] },
    { label: 'Stylelint comparable rules', run: () => runStylelint(source, filePath, language), samples: [] }
  ];

  for (const testCase of cases) {
    await warmCase(testCase, warmups);
  }

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < cases.length; i++) {
      const testCase = cases[(round + i) % cases.length];
      maybeGc();
      testCase.samples.push(await timedBatch(testCase.run, iterations));
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
    'sample unit: elapsed batch time / iterations; file read and configuration construction are outside timed batches',
    `gc before each measured batch: ${typeof globalThis.gc === 'function' ? 'yes' : 'no'}`,
    ...results.map(formatBenchCase),
    `sink: ${benchSink}`
  ].join('\n'));
}

const full = resolveInputFile(inputFile);
const source = await readFile(full, 'utf8');
const language = languageFromPath(full);
await assertBenchmarkable(inputFile, source, full, language);
await runBenchmark(source, full, language);
