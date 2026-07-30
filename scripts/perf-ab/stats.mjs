/**
 * Statistics for the A/B worktree harness.
 *
 * WHY PAIRED DIFFERENCES AND NOT median(A) vs median(B)
 * ----------------------------------------------------
 * Comparing two independent medians assumes the only thing separating the two
 * sample sets is the change under test. That assumption is false here in two
 * separate ways, and each one breaks it on its own:
 *
 * 1. CROSS-WORKTREE BIAS is a CONSTANT OFFSET PER SIDE — path length, inode
 *    locality, page-cache residency, `node_modules` layout. Interleaving does NOT
 *    remove it. Interleaving cancels time-VARYING noise (thermal, background
 *    load); it cannot cancel a bias that is attached to which side you are on,
 *    because that bias is in every sample of that side equally. Only a ratio
 *    against an in-process comparator, or a measured null, addresses it.
 *
 * 2. DRIFT BIAS: the CSS parse-bench was measured running monotonically UPWARD in
 *    wall order (1.067 -> 1.012 -> 1.105 -> 1.114 -> 1.516 ms across five
 *    processes at one commit). Under a monotone trend, two independent medians
 *    are contaminated by whichever side happened to run later.
 *
 * Pairing each A sample with its ADJACENT B sample makes the trend a shared,
 * mostly-cancelling term in every difference, and turns the result into ONE
 * distribution of differences whose spread is directly interpretable as this
 * harness's resolving power. We report that distribution, never two medians.
 */

export function median(xs) {
  if (xs.length === 0) {
    return Number.NaN;
  }
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(xs, q) {
  if (xs.length === 0) {
    return Number.NaN;
  }
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Deterministic PRNG so a reported confidence interval is reproducible from the
 * same samples. A bootstrap that moves when you re-print it is not evidence.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Nonparametric 95% CI for the median of the paired differences, by resampling
 * PAIRS with replacement. Nonparametric because these distributions are skewed
 * and heavy-tailed; a t-interval on them would overstate confidence.
 */
export function bootstrapMedianCI(diffs, { iterations = 5000, seed = 0x5EED, alpha = 0.05 } = {}) {
  if (diffs.length < 2) {
    return { lo: Number.NaN, hi: Number.NaN };
  }
  const rand = mulberry32(seed);
  const meds = new Array(iterations);
  const buf = new Array(diffs.length);
  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < diffs.length; j++) {
      buf[j] = diffs[(rand() * diffs.length) | 0];
    }
    meds[i] = median(buf);
  }
  return { lo: quantile(meds, alpha / 2), hi: quantile(meds, 1 - alpha / 2) };
}

/**
 * Pair A samples with their ADJACENT B samples and express each difference as a
 * percentage of the B side, so results are comparable across cases of wildly
 * different absolute cost.
 */
export function pairedDiffs(aSamples, bSamples) {
  const n = Math.min(aSamples.length, bSamples.length);
  const diffs = [];
  for (let i = 0; i < n; i++) {
    if (bSamples[i] > 0) {
      diffs.push((aSamples[i] - bSamples[i]) / bSamples[i] * 100);
    }
  }
  return diffs;
}

/**
 * The harness's RESOLVING POWER on this case: the half-width of the bootstrap CI
 * on the paired-difference median. This is the smallest effect the measurement
 * could distinguish from zero, derived from the data actually collected rather
 * than from a remembered noise figure.
 *
 * `minPassMs` is a second, independent refusal: a workload of ~1.2ms per pass is
 * dominated by timer granularity, GC phase and JIT tier transitions. Even a tight
 * CI on such a workload is measuring the harness, not the parser.
 */
export function analyse(aSamples, bSamples, { minEffectPct = 5, minPassMs = 5, seed = 0x5EED } = {}) {
  const diffs = pairedDiffs(aSamples, bSamples);
  const med = median(diffs);
  const ci = bootstrapMedianCI(diffs, { seed });
  const halfWidth = (ci.hi - ci.lo) / 2;
  const positive = diffs.filter(d => d > 0).length;
  const bMedMs = median(bSamples);
  const aMedMs = median(aSamples);

  const tooSmall = Number.isFinite(bMedMs) && bMedMs < minPassMs;
  const cannotResolve = !Number.isFinite(halfWidth) || halfWidth > minEffectPct;

  let verdict;
  if (tooSmall) {
    verdict = 'UNRESOLVABLE-WORKLOAD';
  } else if (cannotResolve) {
    verdict = 'UNRESOLVABLE-NOISE';
  } else if (ci.lo > 0) {
    verdict = 'REGRESSION';
  } else if (ci.hi < 0) {
    verdict = 'IMPROVEMENT';
  } else {
    verdict = 'INCONCLUSIVE';
  }

  return {
    n: diffs.length,
    medianPct: med,
    ci,
    resolvingPowerPct: halfWidth,
    spreadPct: { min: Math.min(...diffs), p25: quantile(diffs, 0.25), p75: quantile(diffs, 0.75), max: Math.max(...diffs) },
    positiveOfN: `${positive}/${diffs.length}`,
    aMedMs,
    bMedMs,
    tooSmall,
    minPassMs,
    minEffectPct,
    verdict
  };
}

/**
 * Human-readable reason a verdict was withheld. The brief is explicit that the
 * harness must SAY it cannot resolve an effect rather than emit a confident
 * number, so this text is part of the output, not a debug aid.
 */
export function verdictNote(a) {
  if (a.verdict === 'UNRESOLVABLE-WORKLOAD') {
    return `workload too small: ${a.bMedMs.toFixed(3)}ms/pass < ${a.minPassMs}ms floor; `
      + `this corpus cannot support a decision at any effect size — use a larger corpus`;
  }
  if (a.verdict === 'UNRESOLVABLE-NOISE') {
    return `this corpus resolves effects >= ${a.resolvingPowerPct.toFixed(1)}%, `
      + `which is coarser than the ${a.minEffectPct}% effect requested — no verdict emitted`;
  }
  if (a.verdict === 'INCONCLUSIVE') {
    return `CI [${a.ci.lo.toFixed(1)}%, ${a.ci.hi.toFixed(1)}%] includes zero at a resolving power of `
      + `±${a.resolvingPowerPct.toFixed(1)}%`;
  }
  return `CI [${a.ci.lo.toFixed(1)}%, ${a.ci.hi.toFixed(1)}%] excludes zero`;
}
