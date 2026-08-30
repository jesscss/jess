/**
 * A/B orchestrator for the value-shape question.
 *
 * SAME DIRECTORY, git-toggled source, pre-built lib snapshots swapped per round.
 * Never two worktrees (cross-worktree bias is real in this repo) and never
 * `git stash`. Build both snapshots first:
 *
 *   git checkout <unified-sha>     -- packages/core/src/ast/value-factory.ts
 *   pnpm --filter @jesscss/core build && cp -R packages/core/lib /tmp/lib-unified
 *   git checkout <conditional-sha> -- packages/core/src/ast/value-factory.ts
 *   pnpm --filter @jesscss/core build && cp -R packages/core/lib /tmp/lib-conditional
 *   git checkout <unified-sha>     -- packages/core/src/ast/value-factory.ts
 *
 *   node packages/core/perf/value-shape/ab.mjs <rounds> <iters> <out.jsonl> \
 *        <snapshot-root> unified=lib-unified conditional=lib-conditional [workloads...]
 *
 * Run the SELF-VS-SELF control first (both labels pointing at the same snapshot)
 * to establish the noise floor before attributing anything to the change.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CORE_LIB = resolve(here, '../../lib');

const rounds = Number(process.argv[2]);
const iters = Number(process.argv[3]);
const outfile = process.argv[4];
const snapRoot = process.argv[5];
const variants = [process.argv[6], process.argv[7]].map((s) => {
  const [label, dir] = s.split('=');
  return { label, dir };
});
const workloads = process.argv.slice(8);
if (workloads.length === 0) {
  workloads.push('bootstrap', 'benchmark', 'less-corpus', 'chunk-jess');
}

writeFileSync(outfile, '');

/** Swap in a snapshot and PROVE which variant is now loadable. */
function install(dir) {
  rmSync(CORE_LIB, { recursive: true, force: true });
  cpSync(join(snapRoot, dir), CORE_LIB, { recursive: true });
  const out = execFileSync('node', [join(here, 'variantguard.mjs')], { encoding: 'utf8' });
  const m = out.match(/VARIANT INSTALLED = (\w+)/);
  if (!m) {
    throw new Error(`guard produced no verdict:\n${out}`);
  }
  return m[1];
}

const expected = { 'lib-unified': 'UNIFIED', 'lib-conditional': 'CONDITIONAL' };

for (let r = 0; r < rounds; r++) {
  /*
   * Alternate order each round so thermal/scheduler drift cancels rather than
   * accruing to whichever variant always runs first.
   */
  const order = r % 2 === 0 ? variants : [...variants].reverse();
  for (const v of order) {
    const got = install(v.dir);
    if (expected[v.dir] && got !== expected[v.dir]) {
      throw new Error(`GUARD MISMATCH: installed ${v.dir}, guard reports ${got}`);
    }
    for (const w of workloads) {
      const out = execFileSync('node', [join(here, 'worker.mjs'), w, String(iters)], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
      });
      const rec = JSON.parse(out.trim().split('\n').pop());
      Object.assign(rec, { round: r, label: v.label, libdir: v.dir, guard: got });
      appendFileSync(outfile, `${JSON.stringify(rec)}\n`);
      console.log(`r${r} ${v.label.padEnd(12)} ${w.padEnd(12)} median=${rec.median.toFixed(1)}ms peakHeap=${(rec.peakHeap / 1048576).toFixed(1)}MB`);
    }
  }
}
console.log('DONE ->', outfile);
