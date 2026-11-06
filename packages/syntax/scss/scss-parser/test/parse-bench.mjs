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
 * stylesheet built from committed source, so it needs no cache.
 *
 * `bootstrap-5.3.8` and `foundation-6.9.0` are the libraries vendored under
 * `packages/jess/benchmark/scss-real/`: real authoring, one parse per file, as a
 * compile reads them. `docs/perf/BENCHMARKS.md` says what each fixture stands
 * for. `scripts/grammar-speed-gate.mjs` gates `gen-workload`, and
 * `scripts/bench-scss-real.mjs` reports all three.
 *
 * Every case but the Sass-spec ones must parse whole: a file that throws, or
 * that stops before its end, ends the run with exit 1. The CST entry reports a
 * partial parse in its result rather than throwing, so counting throws is not
 * enough to tell.
 *
 * `BENCH_CASES` and `BENCH_SURFACES` filter as in the Less harness.
 * `BENCH_CALLS=1` adds `calls`, the JavaScript function calls per timed parse,
 * from V8's precise coverage. That mode changes what the engine runs, so its
 * times and instruction counts mean nothing. `BENCH_FILES`, comma-separated
 * paths, adds them as a case named `files`.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Session } from 'node:inspector/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceEndOf } from '@jesscss/core/ast';
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

const vendored = dir => find(`packages/jess/benchmark/scss-real/${dir}`, '*.scss');

const CASES = {
  'sass-spec': find('packages/syntax/scss/scss-parser/.cache/sass-spec/inputs', '*.scss'),
  'bootstrap-5.3.8': vendored('bootstrap-5.3.8'),
  'foundation-6.9.0': vendored('foundation-sites-6.9.0'),
  files: process.env.BENCH_FILES?.split(',') ?? []
};

const TRAILING_TRIVIA = /^(?:\s|\/\/[^\n]*|\/\*[^]*?\*\/)*$/;

/** Whether a surface's result accounts for the whole of `source`. */
const WHOLE = {
  ast: (document, source) => TRAILING_TRIVIA.test(source.slice(sourceEndOf(document))),
  cst: (result, source) => result.ok && result.errors.length === 0 && result.unconsumedFrom === null
    && TRAILING_TRIVIA.test(source.slice(result.span.end))
};

function refuse(name, surface, file, reason) {
  console.error(`${name}/${surface}: REFUSED, ${file} did not parse whole: ${reason}`);
  process.exit(1);
}

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
const countCalls = process.env.BENCH_CALLS === '1';
const self = import.meta.url;

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
    const mustParse = !name.startsWith('sass-spec');
    let thrown = 0;
    const once = () => {
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        try {
          const result = parseSource(source);
          if (mustParse && !WHOLE[surface](result, source)) {
            refuse(name, surface, files?.[i] ?? name, 'the parse stopped before the end of the input');
          }
        } catch (error) {
          if (mustParse) {
            refuse(name, surface, files?.[i] ?? name, error.message);
          }

          // Deliberate rejected inputs are part of the measured corpus.
          thrown++;
        }
      }
    };
    for (let i = 0; i < warmup; i++) {
      once();
    }
    let session;
    if (countCalls) {
      session = new Session();
      session.connect();
      await session.post('Profiler.enable');
      await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
    }
    const samples = [];
    for (let i = 0; i < timed; i++) {
      const started = process.hrtime.bigint();
      once();
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    let calls;
    if (session) {
      const { result } = await session.post('Profiler.takePreciseCoverage');
      session.disconnect();
      const counts = result.filter(script => script.url.startsWith('file:') && script.url !== self)
        .flatMap(script => script.functions.map(fn => fn.ranges[0].count));
      calls = Math.round(counts.reduce((total, count) => total + count, 0) / timed);
    }
    samples.sort((left, right) => left - right);
    out[`${name}/${surface}`] = {
      ...(calls === undefined ? {} : { calls }),
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
