/**
 * Parse-time benchmark for `@jesscss/less-parser`. ONE process = ONE measurement
 * block; it does not compare anything by itself.
 *
 * Use `ab-compare.mjs` to get an A/B verdict — it drives this script, and the
 * interleaving + rebuild discipline it implements is the part that makes the
 * numbers mean anything. Running this once on each of two checkouts is NOT a
 * valid comparison (cross-worktree bias, and one block per version cannot
 * separate a real delta from machine drift).
 *
 * HOW TO RUN
 * ----------
 *   pnpm --filter @jesscss/less-parser build
 *   node packages/less-parser/test/parse-bench.mjs <label> [warmup=8] [timed=25]
 *
 * Emits one JSON line: per case/surface `median`, `min`, `max` and every sample.
 *
 * Measures the built `lib/` — the macro-COMPILED artifact, which is what ships.
 * Rebuild between edits, and keep `check-macro-buildable` green: an interpreter
 * fallback is both slower AND a different tree, so a benchmark taken on a fallback
 * build is measuring something that does not ship.
 *
 * Both surfaces are timed on every case. When a change touches only one grammar,
 * the untouched surface is a same-run CONTROL — it establishes this harness's noise
 * floor on this machine, and a delta on the changed surface that is not clearly
 * outside that floor is not a result.
 *
 * Errors are swallowed per file: the corpus deliberately contains inputs Less
 * rejects, and the cost of failing is part of the workload.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../lib/index.js';
import { parseLessCst } from '../lib/cst.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function find(dir, pattern) {
  try {
    return execFileSync('find', ['-L', resolve(repo, dir), '-type', 'f', '-name', pattern], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n').filter(Boolean).sort();
  } catch {
    return [];
  }
}

/** The three standing Less workloads: one big file, a real project, the unit corpus. */
const CASES = {
  'benchmark.less': [resolve(repo, 'packages/jess/benchmark/benchmark.less')],
  'bootstrap-port': find('node_modules/.pnpm/bootstrap-less-port@2.5.1_less@3.13.1/node_modules/bootstrap-less-port/less', '*.less'),
  'test-data-unit': find('node_modules/@less/test-data/tests-unit', '*.less')
};

const label = process.argv[2] ?? 'run';
const warmup = Number(process.argv[3] ?? 8);
const timed = Number(process.argv[4] ?? 25);

const out = {};
for (const [name, files] of Object.entries(CASES)) {
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

  for (const [surface, fn] of [['ast', parse], ['cst', parseLessCst]]) {
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
