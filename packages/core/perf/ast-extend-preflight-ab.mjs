#!/usr/bin/env node
/**
 * Isolated built-artifact A/B for the AST extend-preflight owner. It compares
 * two complete workspace roots so the candidate never borrows the baseline's
 * core serializer. Both phases use the public Compiler → Stylesheet route.
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const options = { warmup: 20, pairs: 45 };
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  const value = process.argv[++i];
  if (!value || !key.startsWith('--')) {
    throw new Error(`Expected value after ${key}`);
  }
  if (key === '--before-root') {
    options.beforeRoot = resolve(value);
  } else if (key === '--after-root') {
    options.afterRoot = resolve(value);
  } else if (key === '--fixture') {
    options.fixture = resolve(value);
  } else if (key === '--warmup' || key === '--pairs') {
    options[key.slice(2)] = Number(value);
  } else {
    throw new Error(`Unknown option ${key}`);
  }
}
if (!options.beforeRoot || !options.afterRoot || !options.fixture) {
  throw new Error('--before-root, --after-root, and --fixture are required');
}
if (!Number.isInteger(options.warmup) || !Number.isInteger(options.pairs)) {
  throw new Error('--warmup and --pairs must be integers');
}

async function load(root) {
  const module = relative => import(pathToFileURL(resolve(root, relative)).href);
  const [{ Compiler }, { serialize }, { default: lessPlugin }, { lessCompatPlugin }] = await Promise.all([
    module('packages/jess/lib/index.js'),
    module('packages/core/lib/index.js'),
    module('packages/jess-plugin-less/lib/index.js'),
    module('packages/jess-plugin-less-compat/lib/index.js')
  ]);
  const compiler = () => new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
  });
  return { compiler, serialize };
}

function digest(css) {
  return {
    bytes: Buffer.byteLength(css),
    sha256: createHash('sha256').update(css).digest('hex')
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function measure(build, phase) {
  const compiler = build.compiler();
  if (phase === 'parse-render') {
    const start = performance.now();
    const css = await compiler.render(options.fixture);
    return { ms: performance.now() - start, output: digest(css) };
  }
  const { document, context } = await compiler.compile(options.fixture);
  const start = performance.now();
  const result = await context.withDocument(document, () => build.serialize(document, {
    collapseNesting: true,
    context,
    pluginHost: context.pluginHost,
    io: { readFile: specifier => context.readBinary(specifier).catch(() => null) }
  }));
  return { ms: performance.now() - start, output: digest(result.css) };
}

async function runPhase(before, after, phase) {
  for (let i = 0; i < options.warmup; i++) {
    await measure(before, phase);
    await measure(after, phase);
  }
  const beforeTimes = [];
  const afterTimes = [];
  const deltas = [];
  let output;
  for (let i = 0; i < options.pairs; i++) {
    const afterFirst = i % 2 === 1;
    const first = afterFirst ? await measure(after, phase) : await measure(before, phase);
    const second = afterFirst ? await measure(before, phase) : await measure(after, phase);
    const beforeResult = afterFirst ? second : first;
    const afterResult = afterFirst ? first : second;
    if (beforeResult.output.bytes !== afterResult.output.bytes || beforeResult.output.sha256 !== afterResult.output.sha256) {
      throw new Error(`${phase} output changed on pair ${i + 1}`);
    }
    output ??= beforeResult.output;
    beforeTimes.push(beforeResult.ms);
    afterTimes.push(afterResult.ms);
    deltas.push(afterResult.ms - beforeResult.ms);
  }
  return {
    beforeMedianMs: Number(median(beforeTimes).toFixed(3)),
    afterMedianMs: Number(median(afterTimes).toFixed(3)),
    medianDeltaMs: Number(median(deltas).toFixed(3)),
    wins: afterTimes.filter((time, index) => time < beforeTimes[index]).length,
    byteIdentical: true,
    outputBytes: output.bytes,
    outputSha256: output.sha256
  };
}

const [before, after] = await Promise.all([load(options.beforeRoot), load(options.afterRoot)]);
console.log(JSON.stringify({
  fixture: options.fixture,
  warmup: options.warmup,
  pairs: options.pairs,
  'parse-render': await runPhase(before, after, 'parse-render'),
  render: await runPhase(before, after, 'render')
}, null, 2));
