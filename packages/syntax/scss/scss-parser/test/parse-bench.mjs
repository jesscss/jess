/**
 * Parse-time benchmark for `@jesscss/scss-parser`.
 *
 * This measures the built macro-compiled AST and CST artifacts. The Sass-spec
 * cache is optional so a fresh checkout can still run the harness; when it is
 * present, accepted and rejected inputs are reported separately because their
 * parser costs exercise different paths.
 *
 *   pnpm --filter @jesscss/scss-parser build
 *   node packages/syntax/scss/scss-parser/test/parse-bench.mjs <label> [warmup=8] [timed=25]
 *
 * `gen-workload` is the committed generator's SCSS output
 * (`packages/jess/benchmark/gen-workload.mjs`, default scale): one large
 * stylesheet built from committed source, so it needs no cache. It is the SCSS
 * row of `scripts/grammar-speed-gate.mjs`. `BENCH_CASES` and `BENCH_SURFACES`
 * filter as in the Less harness.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../lib/index.js';
import { parseScssCst } from '../lib/cst.js';
import { generate } from '../../../../jess/benchmark/gen-workload.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

function find(dir, pattern) {
  try {
    return execFileSync('find', ['-L', resolve(repo, dir), '-type', 'f', '-name', pattern], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n').filter(Boolean).sort();
  } catch {
    return [];
  }
}

const CASES = {
  'sass-spec': find('packages/syntax/scss/scss-parser/.cache/sass-spec/inputs', '*.scss')
};

function splitCorpus() {
  const accepted = [];
  const rejected = [];
  for (const file of CASES['sass-spec']) {
    const source = readFileSync(file, 'utf8');
    try {
      parse(source);
      accepted.push(source);
    } catch {
      rejected.push(source);
    }
  }
  return {
    'sass-spec-ok': accepted,
    'sass-spec-err': rejected
  };
}

let splitCache;
const split = () => (splitCache ??= splitCorpus());
const label = process.argv[2] ?? 'run';
const warmup = Number(process.argv[3] ?? 8);
const timed = Number(process.argv[4] ?? 25);
const only = process.env.BENCH_CASES ? new Set(process.env.BENCH_CASES.split(',')) : null;
const surfaces = process.env.BENCH_SURFACES ? new Set(process.env.BENCH_SURFACES.split(',')) : null;

const out = {};
for (const [name, files] of [
  ...Object.entries(CASES),
  ['sass-spec-ok', null],
  ['sass-spec-err', null],
  ['gen-workload', null]
]) {
  if (only && !only.has(name)) {
    continue;
  }
  const sources = name === 'gen-workload'
    ? [generate('scss')]
    : files === null
      ? split()[name]
      : files.map(file => readFileSync(file, 'utf8'));
  if (sources.length === 0) {
    continue;
  }
  const bytes = sources.reduce((total, source) => total + Buffer.byteLength(source), 0);
  for (const [surface, parseSource] of [['ast', parse], ['cst', parseScssCst]]) {
    if (surfaces && !surfaces.has(surface)) {
      continue;
    }
    let thrown = 0;
    const once = () => {
      for (const source of sources) {
        try {
          parseSource(source);
        } catch {
          // Deliberate rejected inputs are part of the measured corpus.
          thrown++;
        }
      }
    };
    for (let i = 0; i < warmup; i++) {
      once();
    }
    const samples = [];
    for (let i = 0; i < timed; i++) {
      const started = process.hrtime.bigint();
      once();
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    samples.sort((left, right) => left - right);
    out[`${name}/${surface}`] = {
      files: sources.length,
      kb: +(bytes / 1024).toFixed(1),
      thrown,
      median: +samples[Math.floor(samples.length / 2)].toFixed(4),
      min: +samples[0].toFixed(4),
      max: +samples.at(-1).toFixed(4),
      samples: samples.map(sample => +sample.toFixed(4))
    };
  }
}

console.log(JSON.stringify({ label, out }));
