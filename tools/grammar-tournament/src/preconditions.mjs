/**
 * Hard preconditions checked BEFORE an entry is ranked. A failure REFUSES the
 * entry; it never produces a bad score, because a bad score is a ranking and a
 * ranking implies the number meant something.
 *
 * THE INTERPRETER-FALLBACK TRAP — WHY THIS FILE EXISTS
 * ----------------------------------------------------
 * A grammar with forward references (`const A = node(..., B, ...)` before `B`)
 * cannot be statically evaluated by the parseman macro. The macro then FALLS
 * BACK TO THE INTERPRETER. The build succeeds. The artifact exports normally.
 * It looks like a normal, and much smaller, file.
 *
 * Per `PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §1 a macro-fallback build is NOT
 * AST-equivalent to a macro-compiled one — it emits a DIFFERENT TREE for the
 * same input.
 *
 * This is catastrophic for a tournament ranked on artifact bytes, because the
 * ranking actively REWARDS it: Candidate A generated a probe family whose
 * rules cost 2,834 B where the correct shape cost 104,746 B, a 37x "win", and
 * nearly published it as a breakthrough. It was five interpreter fallbacks.
 *
 * The only visible symptom is that the emitted file carries a RUNTIME
 * `import ... from "parseman"` instead of an inlined table. That is what this
 * checks. It is the same failure class as the `'@' | 32` backtick bug — a
 * check reporting success because it cannot see the failure mode — and it was
 * handed to me by the candidate it would most have benefited.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * True when a built grammar artifact imports parseman AT RUNTIME, which means
 * the macro did not compile it.
 *
 * Matched on the import STATEMENT rather than the bare word, because the
 * inlined reflection table and ordinary comments both mention "parseman"
 * constantly and a substring test would flag every healthy build.
 */
const RUNTIME_IMPORT = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s*["']parseman["']/;

export function detectInterpreterFallback(pkgDir) {
  const grammarDir = resolve(pkgDir, 'lib/grammar');
  const offenders = [];
  const scanned = [];

  const walk = dir => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.name.endsWith('.js') && !e.name.endsWith('.cjs')) {
        continue;
      }
      scanned.push(full);
      let text;
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const m = RUNTIME_IMPORT.exec(text);
      if (m !== null) {
        offenders.push({ file: full, statement: m[0].trim().slice(0, 160) });
      }
    }
  };

  walk(grammarDir);

  return {
    ok: offenders.length === 0 && scanned.length > 0,
    scanned: scanned.length,
    offenders,
    reason: scanned.length === 0
      ? `no grammar artifacts found under ${grammarDir} — nothing was built, so nothing can be ranked`
      : offenders.length > 0
        ? 'interpreter fallback: artifact imports parseman at runtime, so the macro did not compile it. '
          + 'A fallback build is NOT AST-equivalent and its byte count is meaningless.'
        : null
  };
}

/**
 * Guard against an entry scoring below the composed-leaf floor.
 *
 * Candidate B measured ~202,996 B for a grammar with three shared recognition
 * modules composed and ONE trivial rule. Candidate A then measured 61,579 B
 * composing only `cssSyntax`. Both are right for what they measured, and A's
 * correction is the important part: THE FLOOR IS A FUNCTION OF WHICH SHARED
 * MODULES ARE COMPOSED, so a floor quoted without its module list will drift
 * exactly the way the three artifact numbers drifted.
 *
 * So this does not assert a fixed floor. It flags an entry that is
 * suspiciously small relative to the incumbent and asks for the module list,
 * because at that magnitude the overwhelmingly likely cause is the fallback
 * above rather than a breakthrough.
 */
/*
 * DEMOTED FROM REFUSAL TO WARNING (Candidate C, 2026-07-31) — because at 25%
 * this floor REFUSES THE PROJECT'S OWN TARGET STATE:
 *
 *   goal-2 budget, 4x css source   457,784 B  =  13.7% of the incumbent
 *   Candidate A, Shape 3           255,671 B  =   7.6%
 *   Candidate A, current entry     413,720 B  =  12.4%
 *
 * Every successful outcome of the rewrite lands below the floor, so keeping it
 * as a refusal means the harness declines to grade precisely the entries that
 * worked. That is not a conservative gate, it is a gate pointing the wrong way.
 *
 * The floor's own stated reason is "the likely cause is an interpreter
 * fallback" — and `detectInterpreterFallback` above detects that EXACTLY, in
 * this same function, rather than by proxy. The residual worry, a grammar that
 * does not accept the language, is likewise caught exactly and with a real
 * diagnosis by tree identity plus `--min-real`. A byte ratio is a proxy for two
 * things we now measure directly.
 *
 * So: still computed, still printed loudly, no longer a refusal. Refusal is
 * reserved for the exact checks. If the owner wants the hard floor back, it
 * should come back with a fraction below the goal-2 target rather than above
 * it.
 */
export const SUSPICIOUS_FRACTION = 0.25;

export function checkFloor(rankRawBytes, baselineRawBytes) {
  if (rankRawBytes === null) {
    return { ok: false, reason: 'rank artifact missing' };
  }
  const fraction = rankRawBytes / baselineRawBytes;
  if (fraction < SUSPICIOUS_FRACTION) {
    return {
      ok: false,
      fraction,
      reason: `rank artifact is ${(fraction * 100).toFixed(1)}% of the incumbent — below the `
        + `${SUSPICIOUS_FRACTION * 100}% plausibility floor. At this magnitude the likely cause is an `
        + 'interpreter fallback or a grammar that does not accept the language, not a byte win. '
        + 'Entry held for inspection; state which shared recognition modules are composed.'
    };
  }
  return { ok: true, fraction };
}

/** Every precondition, in one call. `ok: false` means REFUSED, not "scored badly". */
export function checkEntry(pkgDir, rankRawBytes, baselineRawBytes) {
  const fallback = detectInterpreterFallback(pkgDir);
  const floor = checkFloor(rankRawBytes, baselineRawBytes);
  return {
    /* Only the EXACT check refuses. See SUSPICIOUS_FRACTION for why the ratio does not. */
    ok: fallback.ok && rankRawBytes !== null,
    fallback,
    floor
  };
}
