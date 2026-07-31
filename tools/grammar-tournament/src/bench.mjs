/**
 * Parse speed, measured so that a number can survive being quoted.
 *
 * THE NOISE FLOOR IS THE POINT
 * ----------------------------
 * Two BYTE-IDENTICAL artifacts interleaved in one directory on this machine
 * measured 5.144 vs 5.200 ms min-of-mins at a 6/15 win rate. That is the
 * floor: a 1.1% "difference" between two copies of the same file.
 *
 * So NOTHING UNDER ~1.5% IS A RESULT, and this module refuses to let a
 * candidate claim otherwise — `classify()` returns NOISE for any delta inside
 * the band and the scoreboard prints that word instead of a percentage.
 *
 * The repo's own measurements are worse than the floor suggests for small
 * corpora: `BENCH_CASES=css-corpus` (33 files, 6.5 KB, ~1.2 ms/pass) spanned
 * -11.8% to +26.4% across eleven identical processes at one commit. A tiny
 * workload cannot resolve anything. The tournament therefore benches the LARGE
 * corpus (benchmark.css at 123 KB, bootstrap at ~280 KB, the test-data css
 * subset at ~1.17 MB) and reports the workload size next to the result.
 *
 * METHOD, STATED ONCE
 * -------------------
 *  - ONE directory. Both sides are snapshots inside the harness's own tree, so
 *    there is no cross-worktree bias. The repo's `perf-ab` harness documents
 *    why interleaving does NOT fix that bias: "interleaving cancels
 *    time-varying noise, and a constant per-side offset is in every sample of
 *    that side equally."
 *  - INTERLEAVED, alternating side per round, so monotone drift (the repo has
 *    measured warmup drifting 1.067 -> 1.516 ms) hits both sides equally.
 *  - MIN-OF-MINS across rounds. The minimum is the least noisy statistic here
 *    because noise is one-directional: interference only ever makes a run
 *    slower.
 *  - WIN RATE alongside, because a min-of-mins with a 7/15 win rate is a tie
 *    that happens to have a smaller minimum. Both are printed; neither alone
 *    is a result.
 */

/** Below this, a delta is indistinguishable from two copies of the same file. */
export const NOISE_FLOOR_PCT = 1.5;

/**
 * Time one side once: parse every source, return elapsed ms.
 *
 * Errors are swallowed BY DESIGN — deliberately malformed corpus entries are
 * part of the workload, and a grammar that rejects them is doing real work
 * that must be timed. Skipping them would let a candidate look fast by
 * failing early on a third of the corpus.
 */
function onePass(parse, sources) {
  for (const s of sources) {
    try {
      parse(s);
    } catch { /* rejection is work; it counts */ }
  }
}

function timeBlock(parse, sources, warmup, timed) {
  for (let i = 0; i < warmup; i++) {
    onePass(parse, sources);
  }
  let min = Number.POSITIVE_INFINITY;
  const samples = [];
  for (let i = 0; i < timed; i++) {
    const t = process.hrtime.bigint();
    onePass(parse, sources);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    samples.push(ms);
    if (ms < min) {
      min = ms;
    }
  }
  return { min, samples };
}

/**
 * Interleaved A/B.
 *
 * @param sides {{ name: string, parse: Function }[]} exactly two
 * @returns per-side min-of-mins, plus the win rate of side B over side A
 */
export function interleavedAB(sides, sources, { rounds = 15, warmup = 5, timed = 5 } = {}) {
  if (sides.length !== 2) {
    throw new Error('interleavedAB: exactly two sides.');
  }
  const mins = { [sides[0].name]: [], [sides[1].name]: [] };
  let winsB = 0;

  for (let r = 0; r < rounds; r++) {
    // Alternate which side goes first, so first-mover cost is shared evenly.
    const order = r % 2 === 0 ? [0, 1] : [1, 0];
    const roundMin = {};
    for (const idx of order) {
      const s = sides[idx];
      const { min } = timeBlock(s.parse, sources, r === 0 ? warmup : 1, timed);
      mins[s.name].push(min);
      roundMin[s.name] = min;
    }
    if (roundMin[sides[1].name] < roundMin[sides[0].name]) {
      winsB++;
    }
  }

  const minOfMins = n => Math.min(...mins[n]);
  const a = minOfMins(sides[0].name);
  const b = minOfMins(sides[1].name);

  return {
    rounds,
    a: { name: sides[0].name, minOfMins: +a.toFixed(4), mins: mins[sides[0].name].map(v => +v.toFixed(4)) },
    b: { name: sides[1].name, minOfMins: +b.toFixed(4), mins: mins[sides[1].name].map(v => +v.toFixed(4)) },
    deltaPct: +(((b - a) / a) * 100).toFixed(2),
    winRateB: `${winsB}/${rounds}`,
    winsB
  };
}

/**
 * Turn a delta into a verdict, or refuse to.
 *
 * `NaN` is handled EXPLICITLY and fails CLOSED. A gate in this project once
 * failed open because `NaN > tol` and `NaN < -tol` are both false, so a NaN
 * silently read as "within tolerance" and the gate passed while checking
 * nothing. Here a non-finite delta is INVALID, which is loud.
 */
export function classify(deltaPct, winRateB, rounds) {
  if (!Number.isFinite(deltaPct)) {
    return { verdict: 'INVALID', text: 'delta is not finite — measurement failed, this is not a pass' };
  }
  const mag = Math.abs(deltaPct);
  if (mag < NOISE_FLOOR_PCT) {
    return {
      verdict: 'NOISE',
      text: `${deltaPct >= 0 ? '+' : ''}${deltaPct}% is inside the ${NOISE_FLOOR_PCT}% noise floor — NOT a result`
    };
  }
  /*
   * A large delta with a coin-flip win rate is one lucky minimum, not a
   * difference. The floor run itself sat at 6/15.
   */
  const decisive = winRateB >= rounds * 0.7 || winRateB <= rounds * 0.3;
  if (!decisive) {
    return {
      verdict: 'UNRESOLVED',
      text: `${deltaPct}% but win rate ${winRateB}/${rounds} is not decisive — one lucky minimum, not a difference`
    };
  }
  return {
    verdict: deltaPct < 0 ? 'FASTER' : 'SLOWER',
    text: `${deltaPct >= 0 ? '+' : ''}${deltaPct}% (win rate ${winRateB}/${rounds})`
  };
}
