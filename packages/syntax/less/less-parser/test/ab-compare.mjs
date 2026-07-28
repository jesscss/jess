/**
 * Interleaved A/B parse-time comparison for a Less grammar change.
 *
 *   A = the WORKING-TREE grammar (your candidate)
 *   B = the same files at HEAD    (the baseline)
 *
 * HOW TO RUN
 * ----------
 *   # with your grammar edit uncommitted in the working tree:
 *   node packages/syntax/less/less-parser/test/ab-compare.mjs [rounds=4] [runs=3] [warmup=8] [timed=25]
 *
 * Restores the working-tree version when it finishes. Takes several minutes: it
 * runs a full macro rebuild between every block.
 *
 * WHY IT IS SHAPED THIS WAY — each of these is load-bearing, do not "simplify" them
 * ---------------------------------------------------------------------------------
 * - SAME worktree, SAME directory, toggled by copying snapshots over the source.
 *   Never two worktree dirs: cross-worktree comparison has a known bias.
 * - Snapshots are taken ONCE up front, so A is measured against exactly the HEAD it
 *   was written against even though the files are swapped repeatedly.
 * - REBUILD between every block. The grammar is macro-compiled into `lib/`; without
 *   a rebuild you are re-measuring the previous version's artifact.
 * - INTERLEAVED `B A B A ...` across several rounds, multiple PROCESSES per version.
 *   Thermal drift and per-process JIT variation are large enough to invent a result
 *   if you run all of one version and then all of the other.
 * - Reports median AND min AND spread AND win-rate. A single median is not a result.
 * - Both surfaces are timed. If your change touches only one grammar, the untouched
 *   surface is a same-run CONTROL: it shows what this harness's noise floor is on
 *   this machine, right now. A delta on the changed surface that is inside the
 *   control's movement is NOT a speed claim — say "neutral" and land on other merits.
 *
 * A neutral result is a perfectly good result. The gate for a grammar cleanup is
 * `ast-identity-oracle.mjs` plus the test suites; this harness exists to prove a
 * cleanup did not COST anything, not to manufacture a win.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const rounds = Number(process.argv[2] ?? 4);
const runs = Number(process.argv[3] ?? 3);
const warmup = process.argv[4] ?? '8';
const timed = process.argv[5] ?? '25';

const FILES = [
  'packages/parser-shared/src/recognition.ts',
  'packages/parser-shared/src/opaque-at-rule.ts',
  'packages/parser-shared/src/pseudo-consts.ts',
  'packages/syntax/css/css-parser/src/grammar.ts',
  'packages/syntax/css/css-parser/src/ast/grammar.ts',
  'packages/syntax/css/css-parser/src/cst-css.ts',
  'packages/syntax/css/css-parser/src/cst.ts',
  'packages/syntax/css/css-parser/src/index.ts',
  'packages/syntax/less/less-parser/src/grammar.ts',
  'packages/syntax/less/less-parser/src/ast/grammar.ts',
  'packages/syntax/less/less-parser/src/cst.ts',
  'packages/syntax/less/less-parser/src/index.ts',
  'packages/syntax/less/less-parser/tsdown.config.ts'
];
const snapDir = mkdtempSync(join(tmpdir(), 'less-ab-'));
const snapPath = (version, file) => join(snapDir, `${version}_${file.replace(/\//g, '_')}`);
const presentPath = (version, file) => `${snapPath(version, file)}.present`;

function snapshotWorking(version, file) {
  if (existsSync(file)) {
    copyFileSync(file, snapPath(version, file));
    writeFileSync(presentPath(version, file), '1');
  } else {
    writeFileSync(presentPath(version, file), '0');
  }
}

function snapshotHead(version, file) {
  try {
    writeFileSync(snapPath(version, file), execFileSync('git', ['show', `HEAD:${file}`], { maxBuffer: 1 << 28 }));
    writeFileSync(presentPath(version, file), '1');
  } catch {
    writeFileSync(presentPath(version, file), '0');
  }
}

function restore(version, file) {
  if (existsSync(presentPath(version, file)) && readFileSync(presentPath(version, file), 'utf8') === '1') {
    mkdirSync(dirname(file), { recursive: true });
    copyFileSync(snapPath(version, file), file);
  } else {
    rmSync(file, { force: true });
  }
}

for (const f of FILES) {
  snapshotWorking('A', f);
  snapshotHead('B', f);
}

function restoreSources(version) {
  for (const f of FILES) {
    restore(version, f);
  }
}

function buildCandidate() {
  execFileSync('pnpm', ['--filter', '@jesscss/parser-shared', 'build'], { stdio: 'ignore' });
  execFileSync('pnpm', ['--filter', '@jesscss/css-parser', 'build'], { stdio: 'ignore' });
  execFileSync('pnpm', ['--filter', '@jesscss/less-parser', 'build'], { stdio: 'ignore' });
}

function checkout(version) {
  restoreSources(version);
  buildCandidate();
}

function restoreAndExit(signal) {
  restoreSources('A');
  process.stderr.write(`\ninterrupted by ${signal}; restored working-tree sources\n`);
  process.exit(130);
}

process.once('SIGINT', restoreAndExit);
process.once('SIGTERM', restoreAndExit);

const results = { A: [], B: [] };
try {
  for (let r = 0; r < rounds; r++) {
    for (const version of ['B', 'A']) {
      checkout(version);
      for (let i = 0; i < runs; i++) {
        const out = execFileSync('node', ['test/parse-bench.mjs', version, warmup, timed],
          { cwd: 'packages/syntax/less/less-parser', encoding: 'utf8', maxBuffer: 1 << 28 });
        results[version].push(JSON.parse(out).out);
      }
      process.stderr.write(`round ${r + 1}/${rounds} ${version} done\n`);
    }
  }
} finally {
  checkout('A');
}

const pct = (a, b) => ((a - b) / b * 100).toFixed(1);
const med = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

console.log('\ncase'.padEnd(24), 'runs', 'B med'.padStart(9), 'A med'.padStart(9), 'dMed'.padStart(8),
  'B min'.padStart(9), 'A min'.padStart(9), 'dMin'.padStart(8), 'A-wins');
for (const c of Object.keys(results.A[0])) {
  const bMed = results.B.map(o => o[c].median);
  const aMed = results.A.map(o => o[c].median);
  const bMin = Math.min(...results.B.map(o => o[c].min));
  const aMin = Math.min(...results.A.map(o => o[c].min));
  let wins = 0;
  for (let i = 0; i < Math.min(aMed.length, bMed.length); i++) {
    if (aMed[i] < bMed[i]) {
      wins++;
    }
  }
  console.log(c.padEnd(24), String(aMed.length).padStart(4),
    med(bMed).toFixed(3).padStart(9), med(aMed).toFixed(3).padStart(9), `${pct(med(aMed), med(bMed))}%`.padStart(8),
    bMin.toFixed(3).padStart(9), aMin.toFixed(3).padStart(9), `${pct(aMin, bMin)}%`.padStart(8),
    `${wins}/${aMed.length}`);
  console.log('   spread B', Math.min(...bMed).toFixed(2), '-', Math.max(...bMed).toFixed(2),
    '  A', Math.min(...aMed).toFixed(2), '-', Math.max(...aMed).toFixed(2));
}
