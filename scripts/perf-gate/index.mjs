#!/usr/bin/env node
/**
 * The perf drift gate.
 *
 * SHIPS DISABLED. `PERF_GATE` defaults to `off`.
 *
 * A gate that is red on an untouched checkout is not a gate; it teaches people
 * to reach for `--no-verify` on the ones that matter. That risk is concrete
 * here: eleven identical processes at one commit, same built artifact, no source
 * change between them, produced AST medians spanning -11.8% to +26.4% on the
 * 33-file / 6.5 KB css corpus. A gate on that workload would fire constantly and
 * be bypassed within a week.
 *
 * So the first obligation of everything below is NOT to misfire, and every
 * design choice follows from it:
 *
 *   - ratios against a committed baseline, so machine speed cancels
 *   - paired within-round differences, so wall-order drift cancels
 *   - an explicit statement of resolving power, so a threshold the workload
 *     cannot see is REFUSED rather than guessed at
 *   - UNRESOLVED and NO_BASELINE and COMPARATOR_MISSING never fail a push
 *   - an override that is easier to type than `--no-verify` and leaves a record
 *
 * MODES
 *   off      (default) print one line and exit 0. No build, no benchmark.
 *   report   run everything, print the full analysis, ALWAYS exit 0.
 *   enforce  same, but a FAIL verdict exits 1.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pairedRatio, driftVerdict } from './stats.mjs';
import { probe } from './comparators.mjs';
import * as baselineStore from './baseline.mjs';
import { CASES, runCase, parsemanEvidence, verifyBuild, assertDialectCoverage } from './measure.mjs';
import { accumulate, alarms, parseTrailers } from './chain.mjs';

const repoRoot = process.cwd();

const numericFlag = (name) => {
  const hit = process.argv.find(a => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

/* ------------------------------------------------------------------ mode -- */

function readMode() {
  const env = (process.env.PERF_GATE ?? '').trim().toLowerCase();
  if (env) {
    if (!['off', 'report', 'enforce'].includes(env)) {
      console.error(`perf-gate: PERF_GATE='${env}' is not one of off|report|enforce`);
      process.exit(2);
    }
    return env;
  }
  const cfg = resolve(repoRoot, '.perf-gate.json');
  if (existsSync(cfg)) {
    try {
      const parsed = JSON.parse(readFileSync(cfg, 'utf8'));
      if (typeof parsed.mode === 'string') {
        return parsed.mode;
      }
    } catch { /* fall through to the safe default */ }
  }
  return 'off';
}

/* --------------------------------------------------------------- tiering -- */

/**
 * Tiering exists so the gate is affordable enough to stay on. Docs-only and
 * non-hot-path pushes must not pay for a build or a benchmark, because a gate
 * that taxes unrelated work is a gate people route around.
 */
const HOT_PATH = [
  /^packages\/syntax\/[^/]+\/[^/]+\/src\/grammar\.ts$/,
  /^packages\/syntax\/[^/]+\/[^/]+\/src\/ast\/grammar\.ts$/,
  /^packages\/syntax\/[^/]+\/[^/]+\/src\/productions\//,
  /^packages\/core\/src\/ast\//
];

const NON_MEASURABLE = [
  /^docs\//,
  /^\.cursor\//,
  /^packages\/docs\//,
  /\.md$/,
  /^\.github\//,
  /(^|\/)__tests__\//,
  /(^|\/)test\//,
  /\.test\.ts$/
];

export function classify(files) {
  const hot = files.filter(f => HOT_PATH.some(re => re.test(f)));
  if (hot.length > 0) {
    return { tier: 'full', hot };
  }
  const measurable = files.filter(f => !NON_MEASURABLE.some(re => re.test(f)));
  if (measurable.length === 0) {
    return { tier: 'skip', hot: [] };
  }
  return { tier: 'light', hot: [], measurable };
}

function changedFiles(range) {
  try {
    return execFileSync('git', ['diff', '--name-only', range], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function upstreamRange() {
  for (const ref of ['origin/dev', 'origin/main']) {
    try {
      const base = execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: repoRoot, encoding: 'utf8' }).trim();
      if (base) {
        return `${base}..HEAD`;
      }
    } catch { /* try the next ref */ }
  }
  return 'HEAD~1..HEAD';
}

function headMessage() {
  try {
    return execFileSync('git', ['log', '-1', '--format=%B'], { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    return '';
  }
}

/* -------------------------------------------------- rebaseline guardrail -- */

/**
 * A push may not change the baseline and a gated source file at the same time.
 * Landing a regression together with the rebaseline that hides it is therefore
 * two separate, individually reviewable pushes rather than one — which is the
 * point: rebaselining should be structurally awkward, not merely discouraged.
 */
function rebaselineGuard(files, tier) {
  const touchesBaseline = files.includes(baselineStore.BASELINE_PATH);
  if (!touchesBaseline) {
    return { ok: true };
  }
  const problems = [];
  if (tier !== 'skip') {
    problems.push(
      `this push modifies ${baselineStore.BASELINE_PATH} AND ${tier === 'full' ? 'hot-path' : 'source'} files. `
      + 'A rebaseline must land on its own so the number that moved is reviewable in isolation.'
    );
  }
  let previous = null;
  try {
    previous = JSON.parse(execFileSync('git', ['show', `HEAD:${baselineStore.BASELINE_PATH}`], {
      cwd: repoRoot, encoding: 'utf8'
    }));
  } catch { /* new baseline; nothing to compare */ }
  if (previous) {
    const next = baselineStore.load(repoRoot).raw;
    const appendOnly = baselineStore.historyIsAppendOnly(previous, next);
    if (!appendOnly.ok) {
      problems.push(appendOnly.reason);
    }
  }
  return { ok: problems.length === 0, problems };
}

/* --------------------------------------------------------------- output -- */

const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};

function emitTrailers(results, env, baseline) {
  say('');
  say('--- paste into your commit message ---------------------------------');
  if (results.length === 0) {
    say('Perf-AB: none (no measurable surface)');
  }
  for (const r of results) {
    if (!r.summary || r.summary.insufficient) {
      say(`Perf-AB: ${r.caseName} UNMEASURED (${r.skipped ?? r.reason ?? 'no usable pairs'})`);
      continue;
    }
    const s = r.summary;
    say(
      `Perf-AB: ${r.caseName} ${s.jessMedianMs.toFixed(2)}ms -> ${s.jessMedianMs.toFixed(2)}ms `
      + `(${r.drift?.driftPct >= 0 ? '+' : ''}${(r.drift?.driftPct ?? 0).toFixed(1)}%) `
      + `n=${s.n} w=${r.warmup} noise=±${s.mdePct.toFixed(1)}% ${r.drift?.verdict ?? 'UNRESOLVED'}`
    );
    const b = baseline?.cases?.[r.caseName];
    say(
      `Perf-Ratio: ${r.caseName}/${r.comparatorId} ${s.ratio.toFixed(3)}x`
      + (b ? ` (baseline ${b.ratio}x @ ${baseline.signOff?.acceptedAt?.slice(0, 9)})` : ' (no committed baseline)')
    );
  }
  say(`Perf-Env: node=${env.node} parseman=${env.parseman.version} resolved=${env.parseman.resolved}`);
  say('--------------------------------------------------------------------');
}

/* ------------------------------------------------------------------ main -- */

async function main() {
  const mode = readMode();
  if (mode === 'off') {
    console.log(
      'perf-gate: disabled (PERF_GATE=off). Enable with PERF_GATE=report to calibrate, '
      + 'PERF_GATE=enforce to gate. See docs/perf/PERF-DRIFT-GATE.md.'
    );
    return 0;
  }

  const range = upstreamRange();
  const files = changedFiles(range);
  const classified = classify(files);

  /*
   * `--force-tier=full` is for calibration runs, which must be able to measure
   * an UNCHANGED tree. It cannot weaken the gate: it only ever adds work.
   */
  const forced = (/^--force-tier=(\w+)$/.exec(process.argv.find(a => a.startsWith('--force-tier=')) ?? '') ?? [])[1];
  const only = (/^--case=(.+)$/.exec(process.argv.find(a => a.startsWith('--case=')) ?? '') ?? [])[1];
  const tier = forced === 'full' ? 'full' : classified.tier;
  const hot = forced === 'full' && classified.hot.length === 0 ? ['(forced)'] : classified.hot;
  const env = { node: process.version, parseman: parsemanEvidence(repoRoot) };

  say(`perf-gate: mode=${mode} tier=${tier} range=${range} files=${files.length}`);
  say(`perf-gate: parseman ${env.parseman.version} @ ${env.parseman.resolved}`);

  const guard = rebaselineGuard(files, tier);
  if (!guard.ok) {
    for (const p of guard.problems) {
      say(`perf-gate: REBASELINE REFUSED: ${p}`);
    }
    say('perf-gate: rebaselining requires owner sign-off; propose with `pnpm perf:baseline:propose`.');
    return mode === 'enforce' ? 1 : 0;
  }

  if (tier === 'skip') {
    say('perf-gate: no measurable surface in this push. No build, no benchmark. PASS');
    return 0;
  }

  const trailers = parseTrailers(headMessage());

  if (tier === 'light') {
    say('perf-gate: source changed but no hot path touched. No benchmark.');
    if (trailers.ab.length === 0 && !trailers.declaredNoSurface) {
      say('perf-gate: NOTE add `Perf-AB: none (no measurable surface)` so a missing trailer always reads');
      say('perf-gate:      as an omission and never as "not applicable".');
    }
    return 0;
  }

  say(`perf-gate: hot path touched -> full A/B (${hot.join(', ')})`);

  /*
   * Runtime, not just a unit test: a dialect that loses its only case selects
   * the empty set and is graded over nothing. scss and jess sat in exactly that
   * state for the project's entire history.
   */
  assertDialectCoverage();

  const baseline = baselineStore.load(repoRoot);
  if (!baseline.present) {
    say(`perf-gate: NO BASELINE at ${baseline.path}. Cannot measure drift from a fixed reference.`);
    say('perf-gate: this is a NON-FAILING outcome by design; a missing baseline says nothing about jess.');
  } else if (baseline.errors) {
    for (const e of baseline.errors) {
      say(`perf-gate: baseline invalid: ${e}`);
    }
    return mode === 'enforce' ? 1 : 0;
  }

  const nullBiasPct = baseline.calibration?.nullBiasPct;
  if (!Number.isFinite(nullBiasPct)) {
    say('perf-gate: NO NULL CALIBRATION recorded. The gate does not know its own noise floor and');
    say('perf-gate: will not grade any case. Run the same-commit null calibration first.');
  }

  const wanted = Object.entries(CASES).filter(([name, spec]) => {
    if (only) {
      return name === only;
    }
    return hot.some(f => f.includes(`/${spec.dialect}/`)) || spec.dialect === 'css' || forced === 'full';
  });

  const results = [];
  for (const [caseName, spec] of wanted) {
    const p = await probe(spec.comparator);
    if (!p.ok) {
      say(`perf-gate: ${caseName}: COMPARATOR_MISSING (${p.reason}) -> UNRESOLVED, not a failure`);
      results.push({ caseName, comparatorId: spec.comparator, skipped: 'COMPARATOR_MISSING', reason: p.reason });
      continue;
    }

    const build = verifyBuild(repoRoot, spec.jess.pkg);
    if (!build.ok) {
      for (const problem of build.problems) {
        say(`perf-gate: ${caseName}: BUILD UNVERIFIED: ${problem}`);
      }
      results.push({ caseName, comparatorId: p.entry.id, skipped: 'BUILD_UNVERIFIED' });
      continue;
    }

    let run;
    try {
      run = await runCase({
        repoRoot,
        caseName,
        rounds: Number(numericFlag('--rounds') ?? 25),
        warmup: Number(numericFlag('--warmup') ?? 8),
        comparatorLoader: () => p.entry.load()
      });
    } catch (error) {
      say(`perf-gate: ${caseName}: measurement failed (${error.message}) -> UNRESOLVED`);
      results.push({ caseName, comparatorId: p.entry.id, skipped: 'MEASUREMENT_FAILED', reason: error.message });
      continue;
    }
    if (run.skipped) {
      say(`perf-gate: ${caseName}: ${run.skipped} -> UNRESOLVED`);
      for (const problem of run.validation?.problems ?? []) {
        say(`  ${problem}`);
      }
      results.push({ caseName, comparatorId: p.entry.id, skipped: run.skipped });
      continue;
    }

    const summary = pairedRatio(run.pairs);
    const b = baseline.cases?.[caseName];
    const thresholdPct = b?.thresholdPct ?? 5;
    const drift = driftVerdict({
      summary,
      baselineRatio: b?.ratio,
      baselineMdePct: b?.mdePct,
      nullBiasPct,
      thresholdPct
    });

    say('');
    say(`perf-gate: ${caseName}  (${run.files} files, ${run.kb} KB, comparator ${p.entry.id}@${p.version})`);
    say(`  workload verified: jess parsed ${run.validation.jess.ok}/${run.validation.jess.total}, `
      + `${p.entry.id} parsed ${run.validation.comparator.ok}/${run.validation.comparator.total}`);
    say(`  jess ${summary.jessMedianMs.toFixed(3)}ms  vs  ${p.entry.id} ${summary.comparatorMedianMs.toFixed(3)}ms`);
    say(`  ratio ${summary.ratio.toFixed(3)}x  CI95 [${summary.ci[0].toFixed(3)}, ${summary.ci[1].toFixed(3)}]  n=${summary.n}`);
    say(`  resolving power: this run can detect >= ${summary.mdePct.toFixed(2)}% (80% power, a=0.05)`);
    say(`  verdict ${drift.verdict}${drift.reason ? `: ${drift.reason}` : ''}`);
    if (drift.verdict === 'UNRESOLVED' && Number.isFinite(drift.roundsToResolve)) {
      say(`  to resolve ${thresholdPct}% this corpus needs ~${drift.roundsToResolve} rounds `
        + `(had ${summary.n}) or a proportionally larger workload`);
    }
    say(`  comparator caveat: ${p.entry.caveat}`);

    results.push({ caseName, comparatorId: p.entry.id, summary, drift, warmup: run.warmup });
  }

  // Chain detector: an alarm, never a measurement.
  if (baseline.signOff?.acceptedAt) {
    const chain = accumulate(repoRoot, baseline.signOff.acceptedAt);
    const band = Number.isFinite(nullBiasPct) ? nullBiasPct : 3.6;
    const fired = alarms(chain, band);
    say('');
    say(`perf-gate: chain since ${baseline.signOff.acceptedAt.slice(0, 9)}: ${chain.commits} commits`);
    for (const [name, c] of Object.entries(chain.cases)) {
      say(`  ${name}: ${c.accumulatedPct >= 0 ? '+' : ''}${c.accumulatedPct.toFixed(2)}% across ${c.steps.length} commits`);
    }
    if (chain.missingTrailer.length) {
      say(`  ${chain.missingTrailer.length} commit(s) carry no Perf-AB trailer: ${chain.missingTrailer.slice(0, 8).join(', ')}`);
    }
    for (const a of fired) {
      say(`  ALARM ${a.kind} ${a.case}: ${a.detail}`);
    }
  }

  emitTrailers(results, env, baseline);

  if (process.argv.includes('--propose')) {
    const measured = results.filter(r => r.summary && !r.summary.insufficient);
    const cases = {};
    for (const r of measured) {
      cases[r.caseName] = {
        comparator: r.comparatorId,
        ratio: +r.summary.ratio.toFixed(4),
        mdePct: +r.summary.mdePct.toFixed(2),
        thresholdPct: baseline.cases?.[r.caseName]?.thresholdPct ?? null,
        rounds: r.summary.n
      };
    }
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const out = baselineStore.propose(repoRoot, {
      signOff: {
        acceptedAt: head,
        acceptedBy: 'UNSIGNED - owner must fill this in',
        acceptedOn: new Date().toISOString().slice(0, 10),
        reason: 'UNSIGNED - state why this baseline is being set or moved'
      },
      calibration: baseline.calibration ?? {
        nullBiasPct: null,
        measuredAt: null,
        method: 'UNSET - run the same-commit null calibration'
      },
      cases,
      history: [
        ...(baseline.history ?? []),
        ...(baseline.signOff
          ? [{
              acceptedAt: baseline.signOff.acceptedAt,
              acceptedOn: baseline.signOff.acceptedOn,
              reason: baseline.signOff.reason,
              ratios: Object.fromEntries(Object.entries(baseline.cases ?? {}).map(([k, v]) => [k, v.ratio]))
            }]
          : [])
      ]
    });
    say('');
    say(`perf-gate: wrote PROPOSAL ${out}`);
    say('perf-gate: this is NOT the live baseline. Promoting it is an owner action:');
    say('perf-gate:   1. fill in signOff.acceptedBy and signOff.reason');
    say('perf-gate:   2. set thresholdPct per case (must exceed that case\'s mdePct)');
    say(`perf-gate:   3. move it over ${baselineStore.BASELINE_PATH} in a push that changes nothing else`);
  }

  const failing = results.filter(r => r.drift?.verdict === 'FAIL');
  const unresolved = results.filter(r => !r.drift || r.drift.verdict !== 'PASS');
  const graded = results.length - unresolved.length;

  say('');
  say(`perf-gate: ${graded} PASS, ${failing.length} FAIL, `
    + `${unresolved.length - failing.length} not graded`);

  /*
   * "PASS" over zero graded cases is the single most dangerous string this
   * script can print, and it printed it routinely: with `postcss` and `sass`
   * absent from the workspace and no null calibration recorded, every case
   * degraded to UNRESOLVED and the run still ended with `perf-gate: PASS`.
   * Readers and CI look at the last line.
   *
   * Exiting ZERO here is still correct and deliberate (docs/perf/PERF-DRIFT-GATE.md
   * §1: a false alarm is worse than a missed regression, and every not-a-pass
   * outcome exits zero). What was wrong was the WORD. A run that graded nothing
   * now says so in the verdict line, and names what stopped each case, so the
   * gate's own blindness is visible instead of being laundered into assurance.
   */
  if (graded === 0) {
    say('perf-gate: NOT A PASS - GRADED NOTHING.');
    say(`perf-gate: ${results.length} case(s) considered, 0 produced a verdict. Reasons:`);
    const reasons = new Map();
    for (const r of results) {
      const why = r.skipped ?? r.drift?.verdict ?? 'NO_VERDICT';
      reasons.set(why, [...(reasons.get(why) ?? []), r.caseName]);
    }
    for (const [why, names] of reasons) {
      say(`perf-gate:   ${why}: ${names.join(', ')}`);
    }
    say('perf-gate: this says NOTHING about performance. It exits zero by design so a');
    say('perf-gate: blind gate never teaches anyone to reach for --no-verify, but it must');
    say('perf-gate: never be read as evidence that a change is clean.');
    return 0;
  }

  if (failing.length === 0) {
    say(`perf-gate: PASS (${graded} of ${results.length} case(s) graded)`);
    return 0;
  }

  /*
   * Escape hatch. `--no-verify` leaves no trace in git history at all; this
   * leaves a permanent, greppable one. Make the honest path the easy path.
   */
  if (trailers.override && trailers.override.length >= 12) {
    say(`perf-gate: OVERRIDDEN by recorded trailer: "${trailers.override}"`);
    say('perf-gate: the regression is accepted and auditable via `git log --grep "Perf-Override"`.');
    return 0;
  }

  say('');
  say('perf-gate: FAIL. If this regression is accepted, record WHY on the commit:');
  say('');
  say('    git commit --amend --no-edit --trailer "Perf-Override: <reason, >=12 chars>"');
  say('');
  say('  That is auditable. `--no-verify` is not recoverable from git history at all.');
  return mode === 'enforce' ? 1 : 0;
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntry) {
  main().then(code => process.exit(code)).catch((error) => {
    /*
     * A crashing gate must not block a push. Failing open is correct here: the
     * gate's own bug is not evidence of a performance regression, and a gate
     * that blocks pushes when IT is broken is the fastest route to `--no-verify`.
     */
    console.error(`perf-gate: internal error, failing open: ${error.stack ?? error.message}`);
    process.exit(0);
  });
}
