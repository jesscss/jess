/**
 * Parse-time benchmark for `@jesscss/jess-parser`. ONE process = ONE measurement
 * block; it does not compare anything by itself.
 *
 * This is the Jess row source for the Parseman-versioned grammar benchmark
 * ledger. Run it whenever a grammar batch changes the pinned Parseman version
 * or replaces repeated token-family `choice(...)` routes with `dispatch(...)`.
 *
 * HOW TO RUN
 * ----------
 *   pnpm --filter @jesscss/jess-parser build
 *   node packages/syntax/jess/jess-parser/test/parse-bench.mjs <label> [warmup=8] [timed=25]
 *
 * Emits one JSON line: per case/surface `median`, `min`, `max` and every sample.
 *
 * Measures the built `lib/` -- the macro-COMPILED artifact, which is what ships.
 * Rebuild between edits, and keep `check:macro` plus `verify:compose-integrity`
 * green: an interpreter fallback is both slower AND a different tree, so a
 * benchmark taken on a fallback build is diagnostic only.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

function messageOf(error) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : String(error);
}

const loadErrors = {};
const surfaces = [];
try {
  const mod = await import('../lib/index.js');
  surfaces.push(['ast', mod.parse]);
} catch (error) {
  loadErrors.ast = messageOf(error);
}
try {
  const mod = await import('../lib/cst.js');
  surfaces.push(['cst', mod.parseJessCst]);
} catch (error) {
  loadErrors.cst = messageOf(error);
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
  'jess-parser-data': find('packages/syntax/jess/jess-parser/test/data', '*.jess'),
  'jess-parser-errors': find('packages/syntax/jess/jess-parser/test/errors', '*.jess'),
  'jess-package-files': find('packages/jess/test/files', '*.jess')
};

const label = process.argv[2] ?? 'run';
const warmup = Number(process.argv[3] ?? 8);
const timed = Number(process.argv[4] ?? 25);

/**
 * Optional comma-separated case filter. Cases in one process share a heap and a
 * JIT profile, so adding a case can move an unrelated case's reading; both sides
 * of an A/B must always use the same filter.
 */
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
  for (const [surface, fn] of surfaces) {
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

console.log(JSON.stringify({ label, loadErrors, out }));
