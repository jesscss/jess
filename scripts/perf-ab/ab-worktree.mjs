#!/usr/bin/env node
/**
 * Semi-permanent A/B worktree harness for HISTORICAL perf comparison.
 *
 *   A = this worktree (your current work)
 *   B = ~/git/worktrees/jess/bench-b, parked on an older commit
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
 * ----------------------------------------
 * The grammar cleanup's per-commit perf gate is DIFFERENTIAL against the parent
 * commit, which is structurally blind to gradual drift: a +2% commit reads as
 * inconclusive, lands, and becomes the reference for the next one. Twenty of those
 * compound to roughly +49% with every gate green. This harness measures against a
 * FIXED historical commit instead, so drift is measured from the start of the
 * cleanup rather than from yesterday.
 *
 * For a NEAR comparison (your uncommitted edit vs HEAD) do NOT use this — use
 * `packages/syntax/less/less-parser/test/ab-compare.mjs`, which toggles the two
 * states inside ONE directory and is therefore free of cross-worktree bias by
 * construction. This harness exists only because that trick cannot reach a commit
 * whose dependency tree or file layout differs from yours; B needs its own
 * `pnpm install`, which forces a second directory and reintroduces the bias.
 *
 * THE BIAS, AND THE TWO THINGS THAT ACTUALLY ADDRESS IT
 * ----------------------------------------------------
 * Cross-worktree bias is a CONSTANT OFFSET PER SIDE. Interleaving does not remove
 * it: interleaving cancels time-varying noise, and a constant per-side offset is
 * in every sample of that side equally. So:
 *
 *   1. RATIOS, not absolute ms. jess and its comparator run in the SAME worktree
 *      in the SAME process on the SAME corpus, so the per-side environment cost is
 *      in numerator and denominator alike and divides out. `ratio` is the primary
 *      quantity; absolute ms are reported as context, never as the claim.
 *   2. A SAME-COMMIT NULL CALIBRATION. Put A and B on the same commit and run the
 *      whole comparison. The true delta is zero, so whatever comes out IS the
 *      bias, quantified. `calibrate` does this, and it must be re-run whenever the
 *      machine, Node version or toolchain changes.
 *
 * USAGE
 * -----
 *   node scripts/perf-ab/ab-worktree.mjs verify
 *   node scripts/perf-ab/ab-worktree.mjs prepare <commit-ish>
 *   node scripts/perf-ab/ab-worktree.mjs calibrate [--rounds N] [--case NAME]
 *   node scripts/perf-ab/ab-worktree.mjs compare   [--rounds N] [--case NAME]
 *
 * This harness NEVER runs a destructive git command. See `git-guard.mjs`: the only
 * mutating git it can express is `checkout --detach` against a provably clean B.
 */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkoutDetached } from './git-guard.mjs';
import { assertCorpusMatch, buildAndProve, sideEvidence } from './side.mjs';
import { analyse, verdictNote } from './stats.mjs';

const A_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const B_ROOT = join(homedir(), 'git/worktrees/jess/bench-b');

/** Never move these. The main checkout mirrors dev and holds the owner's WIP. */
const PROTECTED = [A_ROOT, join(homedir(), 'git/oss/jess')];

const BENCHES = {
  less: 'packages/syntax/less/less-parser/test/parse-bench.mjs',
  css: 'packages/syntax/css/css-parser/test/parse-bench.mjs'
};

/** Corpora big enough to gate a decision, and the small one kept only for contrast. */
const CASE_SPECS = {
  'css-corpus': { bench: 'css', benchCase: 'css-corpus', size: 'SMALL (33 files, 6.5KB, ~1.2ms/pass)' },
  'test-data-css': { bench: 'css', benchCase: 'test-data-css', size: 'LARGE (151 files, 286KB)' },
  'benchmark.less': { bench: 'less', benchCase: 'benchmark.less', size: 'LARGE (104KB)' },
  'test-data-unit': { bench: 'less', benchCase: 'test-data-unit', size: 'LARGE (136 files)' }
};

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function runBench(root, benchKind, benchCase, label, warmup, timed) {
  const out = execFileSync('node', [join(root, BENCHES[benchKind]), label, String(warmup), String(timed)], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: { ...process.env, BENCH_CASES: benchCase }
  });
  const parsed = JSON.parse(out.trim().split('\n').pop());
  return parsed.out;
}

/**
 * The parse-bench harnesses `continue` past a case whose corpus resolved to zero
 * files, so an ABSENT key is how a silently-missing corpus presents. Treating that
 * as "no data" rather than an error is how a run produces a void number.
 */
function assertCasePresent(out, benchCase, root, label) {
  const keys = Object.keys(out).filter(k => k.startsWith(`${benchCase}/`));
  if (keys.length === 0) {
    throw new Error(
      `${label}: bench case '${benchCase}' produced NO output in ${root}. The parse-bench skips `
      + 'cases whose corpus resolves to zero files, so this is a missing corpus, not a missing result. '
      + 'Any number from this run would be void.'
    );
  }
  return keys;
}

function printEvidence(a, b) {
  console.log('=== EVIDENCE (paths and versions first; numbers are meaningless without them) ===');
  for (const s of [a, b]) {
    console.log(`  ${s.label}  ${s.root}`);
    console.log(`      HEAD        ${s.head}${s.dirty ? `  (DIRTY: ${s.dirty} entries)` : '  (clean)'}`);
    console.log(`      node        ${s.node}`);
    console.log(`      pnpm pkgs   ${s.install.pnpmPackages}`);
    console.log(`      parseman    ${s.parseman.version}  ${s.parseman.path}`);
    console.log(`      corpus      ${s.corpus.resolved ?? 'MISSING'}`);
    if (s.corpus.present) {
      console.log(`         less     ${s.corpus.less.files} files ${s.corpus.less.bytes}B sha=${s.corpus.less.sha256}`);
      console.log(`         css      ${s.corpus.css.files} files ${s.corpus.css.bytes}B sha=${s.corpus.css.sha256}`);
    }
    console.log(`      repo css    ${s.localCssCorpus.files} files ${s.localCssCorpus.bytes}B sha=${s.localCssCorpus.sha256}`);
  }
  const problems = assertCorpusMatch(a, b);
  if (problems.length > 0) {
    console.log('\n  CORPUS PROVENANCE PROBLEMS:');
    for (const p of problems) {
      console.log(`    ! ${p}`);
    }
  } else {
    console.log('\n  corpus provenance: A and B MATCH (identical resolved path and content hash)');
  }
  console.log('');
  return problems;
}

function cmdVerify() {
  const a = sideEvidence(A_ROOT, 'A');
  const b = sideEvidence(B_ROOT, 'B');
  const problems = printEvidence(a, b);
  process.exit(problems.length > 0 ? 1 : 0);
}

function cmdPrepare(commitish) {
  if (!commitish) {
    console.error('prepare needs a commit-ish');
    process.exit(1);
  }
  console.log(`Moving B (${B_ROOT}) to ${commitish}`);
  const head = checkoutDetached(B_ROOT, commitish, PROTECTED);
  console.log(`B HEAD is now ${head}`);
  console.log('Installing B...');
  execFileSync('pnpm', ['install', '--prefer-offline'], { cwd: B_ROOT, stdio: 'inherit' });
  const ev = sideEvidence(B_ROOT, 'B');
  console.log(`B installed: ${ev.install.pnpmPackages} pnpm packages, parseman ${ev.parseman.version}`);
  console.log('Building B...');
  buildAndProve(B_ROOT, 'B');
  console.log('B built and artifact-proven.');
}

/**
 * Interleaved B A B A ... across rounds, ONE process per block. Samples are paired
 * by position so an adjacent A and B share as much of the machine's state as
 * possible; see `stats.mjs` for why the pairing is the load-bearing part.
 */
function runInterleaved({ benchKind, benchCase, rounds, warmup, timed }) {
  const samples = { A: [], B: [] };
  for (let r = 0; r < rounds; r++) {
    for (const side of ['B', 'A']) {
      const root = side === 'A' ? A_ROOT : B_ROOT;
      const out = runBench(root, benchKind, benchCase, side, warmup, timed);
      const keys = assertCasePresent(out, benchCase, root, side);
      samples[side].push({ round: r, out, keys });
    }
    process.stderr.write(`  round ${r + 1}/${rounds} done\n`);
  }
  return samples;
}

function report({ caseName, spec, samples, minEffect, minPass, aEv, bEv, isNull }) {
  const surfaces = samples.A[0].keys;
  const rows = [];
  console.log(`\n=== ${caseName}  ${spec.size} ===`);
  for (const surfaceKey of surfaces) {
    // One median per PROCESS, paired by round.
    const aPer = samples.A.map(s => s.out[surfaceKey].median);
    const bPer = samples.B.map(s => s.out[surfaceKey].median);
    const a = analyse(aPer, bPer, { minEffectPct: minEffect, minPassMs: minPass });
    rows.push({ surfaceKey, a });
    console.log(`  ${surfaceKey}`);
    console.log(`    B median ${a.bMedMs.toFixed(3)}ms   A median ${a.aMedMs.toFixed(3)}ms   (context only, NOT the claim)`);
    console.log(`    paired diff  median ${a.medianPct >= 0 ? '+' : ''}${a.medianPct.toFixed(2)}%   `
      + `95% CI [${a.ci.lo.toFixed(2)}%, ${a.ci.hi.toFixed(2)}%]   n=${a.n} pairs`);
    console.log(`    spread       min ${a.spreadPct.min.toFixed(2)}%  p25 ${a.spreadPct.p25.toFixed(2)}%  `
      + `p75 ${a.spreadPct.p75.toFixed(2)}%  max ${a.spreadPct.max.toFixed(2)}%   A-slower ${a.positiveOfN}`);
    console.log(`    resolving power  ±${a.resolvingPowerPct.toFixed(2)}%  (smallest effect this run could call)`);
    console.log(`    VERDICT      ${a.verdict} — ${verdictNote(a)}`);
    if (isNull) {
      console.log(`    NULL EXPECTATION 0.00% — the measured value IS the cross-worktree bias on this case`);
    }
  }
  return rows;
}

/** Trailer block, copy-pasteable into a commit message exactly as printed. */
function printTrailers({ rows, aEv, bEv, warmup, timed, rounds }) {
  console.log('\n--- commit trailers (paste verbatim) ---');
  for (const { surfaceKey, a } of rows) {
    const noise = `±${a.resolvingPowerPct.toFixed(1)}%`;
    console.log(
      `Perf-AB: ${surfaceKey} ${a.bMedMs.toFixed(2)}ms -> ${a.aMedMs.toFixed(2)}ms `
      + `(${a.medianPct >= 0 ? '+' : ''}${a.medianPct.toFixed(1)}%) `
      + `n=${a.n}x${timed} w=${warmup} rounds=${rounds} noise=${noise} ${a.verdict}`
    );
  }
  console.log(`Perf-Env: node=${process.version} parseman=${aEv.parseman.version} resolved=${aEv.parseman.path}`);
  console.log(`Perf-Env: A=${aEv.head} B=${bEv.head} corpus=${aEv.corpus.less?.sha256 ?? 'MISSING'}`);
  console.log('--- end trailers ---');
  console.log(
    '\nNOTE: `Perf-Ratio:` is NOT emitted by this command. A ratio must be measured in the\n'
    + 'SAME process as the comparator to cancel per-side bias — see ratio-probe.mjs.'
  );
}

function cmdRun(isNull) {
  const rounds = Number(arg('--rounds', '6'));
  const warmup = Number(arg('--warmup', '8'));
  const timed = Number(arg('--timed', '25'));
  const minEffect = Number(arg('--min-effect', '5'));
  const minPass = Number(arg('--min-pass-ms', '5'));
  const only = arg('--case', null);

  const aEv = sideEvidence(A_ROOT, 'A');
  const bEv = sideEvidence(B_ROOT, 'B');
  const problems = printEvidence(aEv, bEv);

  if (isNull && aEv.head !== bEv.head) {
    console.error(
      `calibrate requires A and B on the SAME commit (A=${aEv.head} B=${bEv.head}).\n`
      + `Run: node scripts/perf-ab/ab-worktree.mjs prepare ${aEv.head}`
    );
    process.exit(1);
  }
  if (problems.length > 0 && !isNull) {
    console.error('Refusing to compare: corpus provenance differs between A and B (see above).');
    process.exit(1);
  }

  const cases = only ? [only] : Object.keys(CASE_SPECS);
  for (const caseName of cases) {
    const spec = CASE_SPECS[caseName];
    if (!spec) {
      console.error(`unknown case ${caseName}`);
      process.exit(1);
    }
    process.stderr.write(`\nrunning ${caseName} (${spec.bench})\n`);
    const samples = runInterleaved({ benchKind: spec.bench, benchCase: spec.benchCase, rounds, warmup, timed });
    const rows = report({ caseName, spec, samples, minEffect, minPass, aEv, bEv, isNull });
    printTrailers({ rows, aEv, bEv, warmup, timed, rounds });
  }
}

const cmd = process.argv[2];
if (cmd === 'verify') {
  cmdVerify();
} else if (cmd === 'prepare') {
  cmdPrepare(process.argv[3]);
} else if (cmd === 'calibrate') {
  cmdRun(true);
} else if (cmd === 'compare') {
  cmdRun(false);
} else {
  console.error('usage: ab-worktree.mjs <verify|prepare <commit>|calibrate|compare> [--rounds N] [--case NAME]');
  process.exit(1);
}
