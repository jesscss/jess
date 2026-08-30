/**
 * Paired-difference statistics for the perf drift gate.
 *
 * WHY PAIRED, AND WHY LOGS
 * ------------------------
 * The measured workloads drift monotonically upward in wall order within a
 * single process (observed: 1.067 -> 1.012 -> 1.105 -> 1.114 -> 1.516 ms across
 * one warmup sweep). Under that bias, `median(A)` vs `median(B)` is the wrong
 * statistic even when the samples are interleaved, because the two medians are
 * drawn from different regions of the drift curve.
 *
 * So every round measures jess and the comparator ADJACENTLY and reduces them
 * to a single paired observation before any aggregation happens. Whatever the
 * machine was doing during round r affects both halves of round r, and divides
 * out. We aggregate the DISTRIBUTION OF PAIRS, never two independent summaries.
 *
 * The pairing statistic is `ln(a) - ln(b)` rather than `a - b` because the
 * quantity being gated is a RATIO. Differences of logs are symmetric in the
 * direction of the effect (a 2x regression and a 2x improvement are equal and
 * opposite), they make the round-to-round multiplicative noise additive so the
 * usual mean/sd machinery is valid, and `exp(mean)` is the ratio we report.
 *
 * RESOLVING POWER IS THE POINT
 * ----------------------------
 * Every summary this module produces carries `mdePct` — the smallest relative
 * effect the run could have detected. A caller that enforces a threshold
 * smaller than `mdePct` is enforcing a number its workload cannot see, and it
 * must say so instead of emitting a verdict. See `verdict()`.
 */

/** Student-t 97.5th percentile by degrees of freedom; index 0 unused. */
const T975 = [
  Number.NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
  2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093,
  2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045
];

const Z975 = 1.959964;

/** z at 80% power; `(z975 + z80)` is the standard two-sided MDE multiplier. */
const Z80 = 0.841621;

function tQuantile975(df) {
  if (df < 1) {
    return Number.NaN;
  }
  return df < T975.length ? T975[df] : Z975 + (T975[T975.length - 1] - Z975) * (T975.length - 1) / df;
}

export function median(xs) {
  if (xs.length === 0) {
    return Number.NaN;
  }
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs) {
  return xs.reduce((n, x) => n + x, 0) / xs.length;
}

function stdev(xs) {
  if (xs.length < 2) {
    return Number.NaN;
  }
  const m = mean(xs);
  return Math.sqrt(xs.reduce((n, x) => n + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Median absolute deviation, scaled to be a consistent estimator of sigma. */
function mad(xs) {
  const m = median(xs);
  return 1.4826 * median(xs.map(x => Math.abs(x - m)));
}

const pct = logDelta => (Math.expm1(logDelta) * 100);

/**
 * Reduce paired (jess, comparator) round timings to a ratio estimate with an
 * explicit statement of what it can and cannot resolve.
 *
 * @param {Array<{ a: number, b: number }>} pairs adjacent per-round timings, ms
 */
export function pairedRatio(pairs) {
  const usable = pairs.filter(p => Number.isFinite(p.a) && Number.isFinite(p.b) && p.a > 0 && p.b > 0);
  const n = usable.length;
  if (n < 3) {
    return {
      n,
      insufficient: true,
      reason: `need >=3 usable pairs to estimate a distribution, got ${n}`
    };
  }

  const diffs = usable.map(p => Math.log(p.a) - Math.log(p.b));
  const centre = median(diffs);

  /*
   * sd drives the interval; MAD is reported alongside so a caller can see when
   * an outlier is inflating the interval rather than a genuinely noisy corpus.
   */
  const sd = stdev(diffs);
  const robustSd = mad(diffs);
  const stderr = sd / Math.sqrt(n);
  const half = tQuantile975(n - 1) * stderr;

  // The smallest true effect this run would detect 80% of the time at a=0.05.
  const mdeLog = (Z975 + Z80) * stderr;

  return {
    n,
    insufficient: false,
    ratio: Math.exp(centre),
    ratioLog: centre,
    ci: [Math.exp(centre - half), Math.exp(centre + half)],
    ciHalfWidthPct: pct(half),
    mdePct: pct(mdeLog),
    spreadPct: pct(sd),
    robustSpreadPct: pct(robustSd),
    jessMedianMs: median(usable.map(p => p.a)),
    comparatorMedianMs: median(usable.map(p => p.b))
  };
}

/**
 * How many rounds would be needed to resolve `targetPct`, given what this run
 * actually observed. Lets the gate say "this corpus cannot distinguish an X%
 * effect" with a concrete remedy instead of a shrug.
 */
export function roundsToResolve(summary, targetPct) {
  if (summary.insufficient || !(targetPct > 0)) {
    return Number.NaN;
  }
  const ratio = summary.mdePct / targetPct;
  return Math.ceil(summary.n * ratio * ratio);
}

/**
 * Compare a freshly measured ratio against a committed baseline ratio.
 *
 * The uncertainty that matters is NOT the within-run interval alone. The
 * baseline was measured in a different process, on a different machine, at a
 * different time. Three independent components are combined in quadrature:
 *
 *   - `summary.mdePct`      what this run can resolve
 *   - `baselineMdePct`      what the baseline run could resolve
 *   - `nullBiasPct`         measured same-commit A/B bias (null calibration)
 *
 * `nullBiasPct` is the empirical answer to "how far apart do two measurements
 * of THE SAME CODE land". Without it there is no honest floor, so this function
 * returns `UNCALIBRATED` rather than guessing. That is deliberate: it is the
 * structural reason the gate ships disabled.
 */
export function driftVerdict({ summary, baselineRatio, baselineMdePct, nullBiasPct, thresholdPct }) {
  if (summary.insufficient) {
    return { verdict: 'UNRESOLVED', reason: summary.reason };
  }
  if (!Number.isFinite(baselineRatio) || baselineRatio <= 0) {
    return { verdict: 'NO_BASELINE', reason: 'no committed baseline ratio for this case' };
  }
  if (!Number.isFinite(nullBiasPct)) {
    return {
      verdict: 'UNCALIBRATED',
      reason: 'no same-commit null calibration recorded; the gate cannot know its own noise floor'
    };
  }

  const driftLog = summary.ratioLog - Math.log(baselineRatio);
  const driftPct = pct(driftLog);

  const bMde = Number.isFinite(baselineMdePct) ? baselineMdePct : 0;
  const resolvablePct = Math.sqrt(summary.mdePct ** 2 + bMde ** 2 + nullBiasPct ** 2);

  const base = {
    driftPct,
    resolvablePct,
    thresholdPct,
    baselineRatio,
    currentRatio: summary.ratio,
    mdePct: summary.mdePct,
    nullBiasPct
  };

  /*
   * Requirement 4, and the whole reason this gate exists: if the workload
   * cannot resolve the threshold being enforced, REFUSE to grade it. Not a
   * pass (which would launder drift) and not a fail (which would misfire).
   */
  if (resolvablePct > thresholdPct) {
    return {
      ...base,
      verdict: 'UNRESOLVED',
      reason: `corpus cannot distinguish a ${thresholdPct}% effect: resolving power is +/-${resolvablePct.toFixed(2)}% `
        + `(this run +/-${summary.mdePct.toFixed(2)}%, baseline +/-${bMde.toFixed(2)}%, null bias +/-${nullBiasPct.toFixed(2)}%)`,
      roundsToResolve: roundsToResolve(summary, thresholdPct)
    };
  }

  if (driftPct <= thresholdPct) {
    return { ...base, verdict: 'PASS' };
  }

  /*
   * Over threshold, but only actionable if the observed drift clears the
   * combined noise floor. Otherwise the number is real-looking and unsupported.
   */
  if (driftPct - resolvablePct <= 0) {
    return {
      ...base,
      verdict: 'UNRESOLVED',
      reason: `drift ${driftPct.toFixed(2)}% exceeds the ${thresholdPct}% threshold but not the +/-${resolvablePct.toFixed(2)}% noise floor`
    };
  }

  return {
    ...base,
    verdict: 'FAIL',
    reason: `cumulative drift ${driftPct.toFixed(2)}% vs committed baseline exceeds the ${thresholdPct}% threshold `
      + `and the +/-${resolvablePct.toFixed(2)}% noise floor`
  };
}
