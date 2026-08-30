/**
 * Parse-time benchmark for `@jesscss/css-parser`. ONE process = ONE measurement
 * block; it does not compare anything by itself.
 *
 * Mirror of `packages/less-parser/test/parse-bench.mjs` — same shape, same output
 * schema, same swallow-per-file policy — so the two can be driven by one A/B
 * driver and read side by side. The `css-corpus` case is the SAME 33 files the
 * Less harness benches, which is what makes "Less parsing plain CSS" separable
 * from "Less parsing Less".
 *
 * HOW TO RUN
 * ----------
 *   pnpm --filter @jesscss/css-parser build
 *   node packages/css-parser/test/parse-bench.mjs <label> [warmup=8] [timed=25]
 *
 * Measures the built `lib/` — the macro-COMPILED artifact, which is what ships.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../lib/index.js';
import { parseCssCst } from '../lib/cst.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

function findFlat(dir, pattern) {
  try {
    return execFileSync('find', ['-L', resolve(repo, dir), '-maxdepth', '1', '-type', 'f', '-name', pattern], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n').filter(Boolean).sort();
  } catch {
    return [];
  }
}

function find(dir, pattern) {
  try {
    return execFileSync('find', ['-L', resolve(repo, dir), '-type', 'f', '-name', pattern], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n').filter(Boolean).sort();
  } catch {
    return [];
  }
}

const CASES = {
  'css-corpus': findFlat('packages/syntax/css/css-parser/test/css', '*.css'),
  'test-data-css': find('node_modules/@less/test-data/tests-unit', '*.css')
};

const label = process.argv[2] ?? 'run';
const warmup = Number(process.argv[3] ?? 8);
const timed = Number(process.argv[4] ?? 25);
const only = process.env.BENCH_CASES ? new Set(process.env.BENCH_CASES.split(',')) : null;

const out = {};
for (const [name, files] of Object.entries(CASES)) {
  if (only && !only.has(name)) {
    continue;
  }
  const sources = [];
  for (const f of files) {
    try {
      sources.push(readFileSync(f, 'utf8'));
    } catch { /* absent */ }
  }
  if (sources.length === 0) {
    continue;
  }
  const bytes = sources.reduce((n, s) => n + Buffer.byteLength(s), 0);

  for (const [surface, fn] of [['ast', parse], ['cst', parseCssCst]]) {
    const once = () => {
      for (const s of sources) {
        try {
          fn(s);
        } catch { /* deliberate corpus errors are part of the workload */ }
      }
    };
    for (let i = 0; i < warmup; i++) {
      once();
    }
    const samples = [];
    for (let i = 0; i < timed; i++) {
      const t = process.hrtime.bigint();
      once();
      samples.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    samples.sort((a, b) => a - b);
    out[`${name}/${surface}`] = {
      files: sources.length,
      kb: +(bytes / 1024).toFixed(1),
      median: +samples[Math.floor(samples.length / 2)].toFixed(4),
      min: +samples[0].toFixed(4),
      max: +samples[samples.length - 1].toFixed(4),
      samples: samples.map(s => +s.toFixed(4))
    };
  }
}
console.log(JSON.stringify({ label, out }));
