/**
 * The accumulated-drift detector: reads the `Perf-AB:` trailer chain out of the
 * commit log and looks for laundering.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The failure mode being defended against is twenty consecutive `+2%` commits
 * that each read as noise and compound to `+49%`. No single differential
 * measurement can see that, because each one only ever looks one commit back.
 * The commit log can, because every commit records its own number — so eight
 * consecutive commits that each shrugged `+1.5%` are visibly `+12.7%` in the
 * log, and the laundering is obvious in a way no single gate run could show.
 *
 * TWO MECHANISMS, DIFFERENT JOBS
 * ------------------------------
 * This module is a DETECTOR, not a measurement. Composed deltas are not
 * reliable arithmetic: measurement error compounds, machines differ, corpora
 * shift. The chain tells you WHEN TO GO LOOK; the absolute baseline ratio in
 * `stats.driftVerdict` tells you WHAT IS ACTUALLY TRUE.
 *
 * So a chain alarm never fails a push on its own. It escalates: it demands the
 * absolute re-measurement, and it makes an UNRESOLVED absolute result loud
 * instead of quiet.
 */

import { execFileSync } from 'node:child_process';

const AB = /^Perf-AB:\s*(.+?)\s+([\d.]+)ms\s*->\s*([\d.]+)ms\s*\(([+-]?[\d.]+)%\)\s*(.*)$/;
const AB_NONE = /^Perf-AB:\s*none\b/i;
const RATIO = /^Perf-Ratio:\s*(\S+)\s+([\d.]+)x/;
const OVERRIDE = /^Perf-Override:\s*(.+)$/;

function gitLog(repoRoot, range) {
  try {
    return execFileSync('git', ['log', '--format=%H%x1f%B%x1e', range], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1 << 28
    });
  } catch {
    return '';
  }
}

export function parseTrailers(message) {
  const out = { ab: [], ratio: [], override: null, declaredNoSurface: false };
  for (const line of message.split('\n').map(l => l.trim())) {
    if (AB_NONE.test(line)) {
      out.declaredNoSurface = true;
      continue;
    }
    const ab = AB.exec(line);
    if (ab) {
      out.ab.push({
        case: ab[1].trim(),
        beforeMs: Number(ab[2]),
        afterMs: Number(ab[3]),
        deltaPct: Number(ab[4]),
        verdict: (/\b(PASS|FAIL|INCONCLUSIVE|UNRESOLVED|REGRESSION|IMPROVEMENT)\b/.exec(ab[5]) ?? [])[1] ?? 'UNSTATED'
      });
      continue;
    }
    const ratio = RATIO.exec(line);
    if (ratio) {
      out.ratio.push({ case: ratio[1], ratio: Number(ratio[2]) });
      continue;
    }
    const ov = OVERRIDE.exec(line);
    if (ov) {
      out.override = ov[1].trim();
    }
  }
  return out;
}

/**
 * Accumulate the chain since the last owner-accepted baseline commit.
 *
 * @param {string} sinceSha `signOff.acceptedAt` from the committed baseline
 */
export function accumulate(repoRoot, sinceSha, headRef = 'HEAD') {
  const raw = gitLog(repoRoot, `${sinceSha}..${headRef}`);
  if (!raw.trim()) {
    return { commits: 0, cases: {}, missingTrailer: [], available: Boolean(sinceSha) };
  }

  const perCase = {};
  const missingTrailer = [];
  let commits = 0;

  const records = raw.split('\x1e').map(s => s.trim()).filter(Boolean).reverse();
  for (const rec of records) {
    const [sha, message = ''] = rec.split('\x1f');
    commits++;
    const t = parseTrailers(message);
    if (t.ab.length === 0 && !t.declaredNoSurface) {
      missingTrailer.push(sha.slice(0, 9));
      continue;
    }
    for (const entry of t.ab) {
      const c = (perCase[entry.case] ??= { steps: [], logSum: 0, positiveRun: 0, maxPositiveRun: 0 });
      c.steps.push({ sha: sha.slice(0, 9), ...entry });
      c.logSum += Math.log1p(entry.deltaPct / 100);
      if (entry.deltaPct > 0) {
        c.positiveRun++;
        c.maxPositiveRun = Math.max(c.maxPositiveRun, c.positiveRun);
      } else {
        c.positiveRun = 0;
      }
    }
  }

  for (const c of Object.values(perCase)) {
    c.accumulatedPct = Math.expm1(c.logSum) * 100;
  }

  return { commits, cases: perCase, missingTrailer, available: true };
}

/**
 * Direction is signal even when magnitude is not. A sub-noise result that is
 * consistently positive across several consecutive commits is a real regression
 * being laundered through the noise band one commit at a time.
 *
 * @param {number} noiseBandPct the harness noise floor; accumulation past it in
 *   the positive direction is the trigger to stop and re-measure absolutely
 */
export function alarms(chain, noiseBandPct, consecutiveLimit = 4) {
  const out = [];
  for (const [name, c] of Object.entries(chain.cases)) {
    if (c.accumulatedPct > noiseBandPct) {
      out.push({
        case: name,
        kind: 'ACCUMULATION',
        detail: `chain since baseline accumulates ${c.accumulatedPct.toFixed(2)}% across ${c.steps.length} `
          + `commits, exceeding the +/-${noiseBandPct}% noise band. Re-measure absolutely before adding another commit.`
      });
    }
    if (c.maxPositiveRun >= consecutiveLimit) {
      out.push({
        case: name,
        kind: 'DIRECTION',
        detail: `${c.maxPositiveRun} consecutive commits measured positive. Consistent direction is signal `
          + 'even when each magnitude is sub-noise; investigate the accumulation rather than adding an N+1th.'
      });
    }
  }
  return out;
}
