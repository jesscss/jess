import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { pairedRatio, driftVerdict, roundsToResolve } from '../perf-gate/stats.mjs';
import { classify } from '../perf-gate/index.mjs';
import { parseTrailers, alarms } from '../perf-gate/chain.mjs';
import { validate, historyIsAppendOnly } from '../perf-gate/baseline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = join(ROOT, 'scripts/perf-gate/index.mjs');

/**
 * Synthetic pairs with a controllable true ratio and a controllable monotone
 * drift, so the estimator can be checked against a KNOWN answer. The drift is
 * the thing the design exists to survive: it multiplies both halves of a round
 * together, exactly as thermal/JIT drift does in a real process.
 */
function synth({ trueRatio, rounds, driftPerRound = 0, noise = 0, seed = 1 }) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
  const pairs = [];
  for (let r = 0; r < rounds; r++) {
    const drift = 1 + driftPerRound * r;
    const b = 10 * drift * (1 + noise * rand());
    const a = b * trueRatio * (1 + noise * rand());
    pairs.push({ a, b });
  }
  return pairs;
}

describe('perf-gate statistics', () => {
  it('recovers a known ratio through a large monotone drift', () => {
    /*
     * 40% upward drift across the run: median-vs-median would be skewed by it,
     * the paired estimator must not be.
     */
    const pairs = synth({ trueRatio: 1.5, rounds: 40, driftPerRound: 0.01 });
    const s = pairedRatio(pairs);
    assert.ok(Math.abs(s.ratio - 1.5) < 0.01, `ratio ${s.ratio} should be ~1.5 despite drift`);
  });

  it('reports a resolving power that widens as noise grows', () => {
    const quiet = pairedRatio(synth({ trueRatio: 1.5, rounds: 25, noise: 0.02, seed: 7 }));
    const loud = pairedRatio(synth({ trueRatio: 1.5, rounds: 25, noise: 0.2, seed: 7 }));
    assert.ok(loud.mdePct > quiet.mdePct * 3, `loud ${loud.mdePct} vs quiet ${quiet.mdePct}`);
  });

  it('predicts the rounds needed to resolve a target, and the prediction holds', () => {
    const base = pairedRatio(synth({ trueRatio: 1.5, rounds: 25, noise: 0.15, seed: 3 }));
    const needed = roundsToResolve(base, 2);
    const bigger = pairedRatio(synth({ trueRatio: 1.5, rounds: needed, noise: 0.15, seed: 3 }));
    assert.ok(bigger.mdePct <= 2.5, `at ${needed} rounds mde was ${bigger.mdePct}, expected <=2.5`);
  });

  it('refuses a verdict when the workload cannot resolve the threshold', () => {
    const summary = pairedRatio(synth({ trueRatio: 1.5, rounds: 10, noise: 0.4, seed: 11 }));
    const v = driftVerdict({
      summary, baselineRatio: 1.5, baselineMdePct: 1, nullBiasPct: 2, thresholdPct: 1
    });
    assert.equal(v.verdict, 'UNRESOLVED');
    assert.match(v.reason, /cannot distinguish a 1% effect/);
    assert.ok(v.roundsToResolve > summary.n);
  });

  it('refuses a verdict when no null calibration has been recorded', () => {
    const summary = pairedRatio(synth({ trueRatio: 2, rounds: 30, noise: 0.01 }));
    const v = driftVerdict({
      summary, baselineRatio: 1.5, baselineMdePct: 0.1, nullBiasPct: undefined, thresholdPct: 5
    });
    assert.equal(v.verdict, 'UNCALIBRATED');
  });

  it('passes an unchanged ratio and fails a real accumulated regression', () => {
    const clean = pairedRatio(synth({ trueRatio: 1.5, rounds: 40, noise: 0.01, seed: 5 }));
    assert.equal(
      driftVerdict({ summary: clean, baselineRatio: 1.5, baselineMdePct: 0.5, nullBiasPct: 1, thresholdPct: 5 }).verdict,
      'PASS'
    );
    const drifted = pairedRatio(synth({ trueRatio: 1.5 * 1.49, rounds: 40, noise: 0.01, seed: 5 }));
    const v = driftVerdict({
      summary: drifted, baselineRatio: 1.5, baselineMdePct: 0.5, nullBiasPct: 1, thresholdPct: 5
    });
    assert.equal(v.verdict, 'FAIL');
    assert.ok(v.driftPct > 45, `expected the compounded ~49% drift, got ${v.driftPct}`);
  });

  it('does not fail a drift that exceeds the threshold but not the noise floor', () => {
    const summary = pairedRatio(synth({ trueRatio: 1.5 * 1.06, rounds: 25, noise: 0.25, seed: 9 }));
    const v = driftVerdict({
      summary, baselineRatio: 1.5, baselineMdePct: 4, nullBiasPct: 5, thresholdPct: 5
    });
    assert.notEqual(v.verdict, 'FAIL');
  });
});

describe('perf-gate tiering', () => {
  it('skips docs-only pushes', () => {
    assert.equal(classify(['docs/perf/V8-ARCHITECTURE.md', 'README.md']).tier, 'skip');
  });

  it('sends grammar and core ast changes to the full A/B', () => {
    assert.equal(classify(['packages/syntax/less/less-parser/src/grammar.ts']).tier, 'full');
    assert.equal(classify(['packages/syntax/css/css-parser/src/ast/grammar.ts']).tier, 'full');
    assert.equal(classify(['packages/core/src/ast/node.ts']).tier, 'full');
  });

  it('treats other source as light', () => {
    assert.equal(classify(['packages/jess/src/cli.ts']).tier, 'light');
  });
});

describe('perf-gate chain detector', () => {
  const commit = (c, pct, verdict) =>
    `msg\n\nPerf-AB: ${c} 10.00ms -> 10.10ms (${pct >= 0 ? '+' : ''}${pct}%) n=25 w=8 noise=±3.6% ${verdict}\n`;

  it('parses the documented trailer shape', () => {
    const t = parseTrailers(commit('less-ast benchmark.less', 1.5, 'INCONCLUSIVE'));
    assert.equal(t.ab.length, 1);
    assert.equal(t.ab[0].case, 'less-ast benchmark.less');
    assert.equal(t.ab[0].deltaPct, 1.5);
    assert.equal(t.ab[0].verdict, 'INCONCLUSIVE');
  });

  it('reads an explicit no-surface declaration', () => {
    assert.equal(parseTrailers('x\n\nPerf-AB: none (no measurable surface)\n').declaredNoSurface, true);
  });

  it('extracts a recorded override reason', () => {
    assert.equal(
      parseTrailers('x\n\nPerf-Override: accepted, correctness fix outranks 6% parse cost\n').override,
      'accepted, correctness fix outranks 6% parse cost'
    );
  });

  it('alarms on accumulation that no single step would have caught', () => {
    const cases = { 'less-ast': { steps: Array(20).fill(0), accumulatedPct: 48.6, maxPositiveRun: 20 } };
    const fired = alarms({ cases }, 3.6);
    assert.ok(fired.some(a => a.kind === 'ACCUMULATION'));
    assert.ok(fired.some(a => a.kind === 'DIRECTION'));
  });

  it('stays quiet on a flat chain', () => {
    const cases = { 'less-ast': { steps: [1, 2], accumulatedPct: 0.4, maxPositiveRun: 1 } };
    assert.equal(alarms({ cases }, 3.6).length, 0);
  });
});

describe('perf-gate baseline guards', () => {
  const good = {
    schema: 1,
    signOff: { acceptedAt: 'abc123', acceptedBy: 'owner', acceptedOn: '2026-07-30', reason: 'initial' },
    cases: { 'less/ast/test-data': { comparator: 'lessc-4.x', ratio: 3.5, mdePct: 2, thresholdPct: 5 } }
  };

  it('accepts a well-formed baseline', () => {
    assert.deepEqual(validate(good), []);
  });

  it('rejects a baseline with no owner sign-off', () => {
    const { signOff, ...rest } = good;
    assert.ok(validate(rest).some(e => /signOff/.test(e)));
  });

  it('rejects a case whose own resolving power cannot see its threshold', () => {
    const bad = { ...good, cases: { c: { comparator: 'x', ratio: 1, mdePct: 9, thresholdPct: 5 } } };
    assert.ok(validate(bad).some(e => /does not resolve its own/.test(e)));
  });

  it('refuses a rewritten or truncated history', () => {
    const prev = { history: [{ acceptedAt: 'a', reason: 'first' }] };
    assert.equal(historyIsAppendOnly(prev, { history: [] }).ok, false);
    assert.equal(historyIsAppendOnly(prev, { history: [{ acceptedAt: 'a', reason: 'edited' }] }).ok, false);
    assert.equal(
      historyIsAppendOnly(prev, { history: [{ acceptedAt: 'a', reason: 'first' }, { acceptedAt: 'b' }] }).ok,
      true
    );
  });
});

describe('perf-gate does not misfire', () => {
  const run = env => spawnSync(process.execPath, [GATE], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }
  });

  it('is disabled by default and does no work', () => {
    const r = run({ PERF_GATE: '' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /disabled/);
  });

  it('passes on an unmodified checkout even in enforce mode', () => {
    const r = run({ PERF_GATE: 'enforce' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it('never exits non-zero in report mode', () => {
    const r = spawnSync(process.execPath, [GATE, '--force-tier=full'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, PERF_GATE: 'report' }
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
