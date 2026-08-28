/**
 * Committed perf baseline: load, validate, and guard against silent rebaselining.
 *
 * WHY A COMMITTED BASELINE AND NOT THE PARENT COMMIT
 * -------------------------------------------------
 * A differential gate (candidate vs HEAD~1) cannot see gradual decay. With a
 * +/-1.4-3.6% noise floor a `+2%` commit reads as inconclusive, lands, and then
 * BECOMES the reference for the next measurement. Twenty such commits compound
 * to roughly +49% and every one of them passed its gate. Nothing in that loop
 * remembers where the cleanup started.
 *
 * This file is that memory. It is a fixed absolute floor, exactly like
 * `oracle-byte-identity.baseline.json` is for correctness, and drift is measured
 * from it rather than from yesterday.
 *
 * REBASELINING IS AN OWNER DECISION
 * ---------------------------------
 * Without that rule an agent simply rebaselines the drift away and the ratchet
 * is theatre. Four structural constraints, none of which depend on an agent
 * choosing to behave:
 *
 *   1. Nothing here writes the live file. `propose` emits `.baseline.json.new`,
 *      mirroring the existing `oracle:less:byte-identity:write` convention.
 *      Promoting it is a manual owner action.
 *   2. A push may not modify the baseline AND a gated source file together.
 *      Landing a regression and the rebaseline that hides it is therefore two
 *      reviewable pushes, not one.
 *   3. `history` is append-only. Mutating or dropping a past entry is a hard
 *      failure, so the record of where the ratchet started cannot be erased.
 *   4. One case per line, sorted, ratio inline — a rebaseline shows up in the
 *      diff as exactly which number moved and by how much.
 *
 * SEAM: the on-disk schema is owned by the comparator-bar/baseline-format work.
 * `validate()` below states the fields THIS gate requires; that work may add
 * fields freely. If the shipped format diverges, change `normalise()` only.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const BASELINE_PATH = 'docs/perf/perf-drift.baseline.json';

/**
 * Required shape. `cases` is keyed `<dialect>/<surface>/<corpus>` so a baseline
 * is always NAMED CASES and never one aggregate: a single pooled number cannot
 * distinguish "nothing moved" from "one case got faster and another got slower".
 *
 * {
 *   "schema": 1,
 *   "signOff": {
 *     "acceptedAt":  "<sha>",          commit the numbers were measured at
 *     "acceptedBy":  "<owner>",
 *     "acceptedOn":  "YYYY-MM-DD",
 *     "reason":      "<why this baseline moved>"
 *   },
 *   "calibration": {
 *     "nullBiasPct":  4.9,             measured same-commit A/B spread
 *     "measuredAt":   "<sha>",
 *     "method":       "<how>"
 *   },
 *   "cases": {
 *     "less/ast/benchmark.less": {
 *       "comparator":   "lessc-4.x",
 *       "ratio":        1.42,
 *       "mdePct":       2.1,           resolving power of the baseline run
 *       "thresholdPct": 5,             cumulative drift allowed vs THIS number
 *       "rounds":       25
 *     }
 *   },
 *   "history": [ { "acceptedAt": "...", "acceptedOn": "...", "reason": "...",
 *                  "ratios": { "<case>": 1.39 } } ]
 * }
 */

export function baselineExists(repoRoot) {
  return existsSync(resolve(repoRoot, BASELINE_PATH));
}

export function load(repoRoot) {
  const file = resolve(repoRoot, BASELINE_PATH);
  if (!existsSync(file)) {
    return { present: false, path: BASELINE_PATH };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { present: true, path: BASELINE_PATH, errors: [`baseline is not valid JSON: ${error.message}`] };
  }
  return { present: true, path: BASELINE_PATH, ...normalise(raw) };
}

function normalise(raw) {
  const errors = validate(raw);
  return {
    errors: errors.length ? errors : null,
    schema: raw.schema,
    signOff: raw.signOff ?? null,
    calibration: raw.calibration ?? null,
    cases: raw.cases ?? {},
    history: Array.isArray(raw.history) ? raw.history : [],
    raw
  };
}

export function validate(raw) {
  const errors = [];
  if (raw.schema !== 1) {
    errors.push(`unsupported baseline schema ${JSON.stringify(raw.schema)}; expected 1`);
  }
  const s = raw.signOff;
  if (!s || typeof s !== 'object') {
    errors.push('missing `signOff`; a baseline without recorded owner sign-off is not a baseline');
  } else {
    for (const k of ['acceptedAt', 'acceptedBy', 'acceptedOn', 'reason']) {
      if (typeof s[k] !== 'string' || s[k].trim() === '') {
        errors.push(`signOff.${k} must be a non-empty string`);
      }
    }
  }
  if (!raw.cases || Object.keys(raw.cases).length === 0) {
    errors.push('baseline has no cases');
  }
  for (const [name, c] of Object.entries(raw.cases ?? {})) {
    if (!(c.ratio > 0)) {
      errors.push(`case ${name}: ratio must be a positive number`);
    }
    if (typeof c.comparator !== 'string' || !c.comparator) {
      errors.push(`case ${name}: comparator must be named`);
    }
    if (!(c.thresholdPct > 0)) {
      errors.push(`case ${name}: thresholdPct must be a positive number`);
    }
    if (Number.isFinite(c.mdePct) && Number.isFinite(c.thresholdPct) && c.mdePct >= c.thresholdPct) {
      errors.push(
        `case ${name}: baseline resolving power (+/-${c.mdePct}%) does not resolve its own `
        + `${c.thresholdPct}% threshold; this case must not be enforced until the corpus is stronger`
      );
    }
  }
  return errors;
}

/**
 * Append-only history check. Compares the baseline in the working tree against
 * the one at `HEAD` so a dropped or rewritten history entry is caught at the
 * moment it would be pushed.
 */
export function historyIsAppendOnly(previousRaw, nextRaw) {
  const prev = Array.isArray(previousRaw?.history) ? previousRaw.history : [];
  const next = Array.isArray(nextRaw?.history) ? nextRaw.history : [];
  if (next.length < prev.length) {
    return { ok: false, reason: `history shrank from ${prev.length} to ${next.length} entries` };
  }
  for (let i = 0; i < prev.length; i++) {
    if (JSON.stringify(prev[i]) !== JSON.stringify(next[i])) {
      const at = prev[i]?.acceptedAt ?? `index ${i}`;
      return { ok: false, reason: `history entry ${at} was modified; history is append-only` };
    }
  }
  return { ok: true };
}

/**
 * Write a PROPOSED baseline next to the live one. Never overwrites the live
 * file: promoting the proposal is the owner's action and shows up as its own
 * reviewable change.
 */
export function propose(repoRoot, next) {
  const out = `${resolve(repoRoot, BASELINE_PATH)}.new`;
  const ordered = {
    schema: 1,
    signOff: next.signOff,
    calibration: next.calibration,
    cases: Object.fromEntries(Object.keys(next.cases).sort().map(k => [k, next.cases[k]])),
    history: next.history ?? []
  };
  writeFileSync(out, `${JSON.stringify(ordered, null, 2)}\n`);
  return out;
}
