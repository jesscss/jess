/*
 * The cross-dialect acceptance matrix. One corpus, four parsers, two assertions.
 *
 * ## What this gate is for
 *
 * The standing ruling is **valid CSS is valid in all four dialects**, and it is
 * ONE-WAY. Until now that ruling was enforced only by four SEPARATE per-package
 * suites over `test/css-superset-corpus.ts` happening to agree. Four suites that
 * agree cannot see a construct none of them names, and they cannot compare
 * dialects at all — each one only knows its own verdict.
 *
 * This file parses every input with all four grammars and asserts BOTH
 * directions:
 *
 *  1. **css accepts ⇒ all three supersets accept.** The ruling itself.
 *  2. **all three supersets accept ⇒ css accepts.** The CSS-BASE GAP detector.
 *     Nothing genuinely dialect-specific appears in all three at once: a real
 *     dialect feature shows up in one dialect, or scss+jess, or less+jess.
 *     Present-in-three-absent-in-css is close to a proof of a missing CSS rule.
 *
 * ## Why the probe is BEHAVIOURAL and nothing else
 *
 * `@charset` is the calibration case for that choice. less named its production
 * `CharsetStatement`, jess named it `Charset`, and **scss had no named
 * production at all** — it is one arm of a `@(?:charset|namespace|layer)` regex
 * (`packages/syntax/scss/scss-parser/src/grammar.ts:4478`). Any check that
 * diffs rule-name sets misses it in scss entirely, and misses every construct
 * hidden inside a shared regex arm. This gate only ever asks "did this input
 * parse", so spelling and structure are invisible to it.
 *
 * The verdict itself comes from `test/dialects.ts`, which is why `ok` alone is
 * not trusted (parseman reports `ok` for a run that consumed nothing).
 *
 * ## Calibration — the gate is INVALID until it finds both known positives
 *
 * A gate that passes because its corpus cannot express the failure is the exact
 * failure mode here. Three known real violations, all checked — and the third
 * is the standing proof that the doctrine is not decorative: this gate shipped
 * green over an at-rule-only corpus while `min(U+0-7F)` was a live direction-1
 * violation, because no probe was a value. The corpus now has a VALUE channel.
 *
 *  - **`@charset "utf-8";` then `@import "a.css";`** — the canonical prologue of
 *    css-syntax-3 §3.2 / css-cascade-5 §3. `css` rejected it while all three
 *    supersets accepted, i.e. a DIRECTION 2 violation. Fixed at `7d32a7fca`, so
 *    it is green here. Calibrated by DELETING that commit's single
 *    `optional(g.CharsetStatement)` arm from the CSS `Stylesheet` sequence and
 *    re-running: the probe `@charset then @import — the canonical prologue`
 *    reported `css=reject less/scss/jess=accept` and this gate failed direction
 *    2 on it. The arm was then restored. The probe is retained so the fix
 *    cannot silently regress.
 *  - **`@namespace url(http://x);`** — css-namespaces-3 §2 admits `<url>` as
 *    well as `<string>`. This gate found it live, with nothing reverted, and it
 *    was then closed by `d5c8f72bb` mid-write. Calibrated the same way: putting
 *    that commit's two lines back to their inline `balanced('(', ')')` spelling
 *    brought back exactly the four `@namespace url()` rows and no others.
 *    Notably the defect was neither namespaces nor `url()` — it was a lone `/`
 *    inside ANY bracketed group in a statement prelude.
 *  - **`min(U+0-7F)` and `a { b: U+0-7F }`** — a `<urange>` is one opaque CSS
 *    token (css-syntax-3 §4.3.15). css, less and scss accepted; jess refused
 *    BOTH, because the jess grammar carried no `<urange>` production at all.
 *    The at-rule-only corpus could not express it, which is why the value
 *    channel exists. Calibrated by deleting the two `g.UnicodeRange` arms the
 *    fix added: the four urange probes drop to `[css, less, scss]` and
 *    direction 1 fails on them, together with the two breadth stylesheets that
 *    contain a real `unicode-range` declaration.
 *
 * All three known positives are therefore green today, and each was confirmed by
 * reverting the fix and watching this gate go red. None is green because the
 * corpus cannot express it.
 *
 * ## Findings are RECORDED, not fixed, and not thresholded
 *
 * Landing this gate red would be impractical, and a threshold or a count would
 * let a new violation hide behind a fixed one. So both directions carry a NAMED
 * allowlist and the assertion is SET EQUALITY: a new violation fails, and a
 * violation that gets FIXED also fails, because a stale pin is how an allowlist
 * rots into a permanent exemption. Each entry states whether the input is
 * spec-valid CSS, which is what decides who is wrong.
 *
 * Note the legitimate asymmetry the "without a block" family represents: `css`
 * accepts `@keyframes a;`, `@page;`, `@font-face;` and friends through its
 * permissive generic at-rule statement arm, and the supersets that REFUSE them
 * may be right — Sass+ rejects some invalid CSS by design. Those are flagged
 * for an owner ruling, not asserted to be superset defects.
 */
import { describe, expect, it } from 'vitest';
import { DIALECTS, type Dialect, parseVerdict } from '../dialects.js';
import { AT_KEYWORDS, TARGETED_PROBES, VALUE_AXES, VALUE_PROBES } from './acceptance-corpus.js';
import { buildCorpus, readEntry } from '../../packages/syntax/css/css-parser/test/render-differential/corpus.mjs';

const SUPERSETS = ['less', 'scss', 'jess'] as const satisfies readonly Dialect[];

/** One row of the matrix: an input, its name, and the four verdicts. */
interface Row {
  readonly name: string;
  readonly channel: 'targeted' | 'breadth';
  readonly source: string;
  readonly accepted: readonly Dialect[];
}

/**
 * A recorded violation. `accepted` is the four-dialect verdict AT LANDING and
 * is part of the pin: a violation that changes SHAPE (a different dialect
 * starts rejecting) fails, rather than staying quietly allowlisted.
 */
interface Allowed {
  readonly name: string;
  readonly accepted: readonly Dialect[];
  /** Is the input valid CSS? This is what decides which side is the defect. */
  readonly validCss: boolean | 'n/a — whole file';
  readonly reason: string;
}

/* ------------------------------------------------------------------ DIRECTION 1
 * `css` accepts and at least one superset refuses.
 *
 * Three of these are inputs that ARE valid CSS and that `jess` alone refuses —
 * real jess defects. The rest are `css` over-accepting invalid CSS through its
 * permissive at-rule statement arm, where the refusing dialect is arguably
 * correct and an owner ruling is what is actually needed.
 */
const DIRECTION_1_ALLOWLIST: readonly Allowed[] = [
  // -- valid CSS that a superset refuses. These are defects in that superset. --
  {
    name: 'targeted:@layer statement then @import',
    accepted: ['css', 'less', 'scss'],
    validCss: true,
    reason:
      'css-cascade-5 §3 admits layer statements BEFORE @import, so `@layer base; @import "a.css";` '
      + 'is valid CSS. jess refuses it. Defect in jess: its prologue does not admit @import after a '
      + 'layer statement.'
  },
  {
    name: 'targeted:@page with a pseudo',
    accepted: ['css', 'less', 'scss'],
    validCss: true,
    reason:
      'css-page-3 §3 admits page pseudo-classes (:first/:left/:right/:blank) in a page selector, so '
      + '`@page :first { margin: 1cm }` is valid CSS. jess refuses it. Defect in jess.'
  },

  // ---- css over-accepting invalid CSS. Needs an owner ruling, not a fix. ----
  {
    name: 'targeted:@charset with a url() prelude',
    accepted: ['css', 'less', 'scss'],
    validCss: false,
    reason:
      'css-syntax-3 §3.2 gives @charset a <string> prelude only, so `@charset url(utf-8);` is NOT '
      + 'valid CSS. css/less/scss all accept it and jess refuses. OWNER RULING: three dialects are '
      + 'over-permissive here and jess is the one behaving to spec — the ruling decides whether the '
      + 'superset rule obliges jess to match the over-acceptance.'
  },
  {
    name: 'targeted:@keyframes without a block',
    accepted: ['css'],
    validCss: false,
    reason:
      '`@keyframes a;` is not valid CSS (css-animations-1 §4 — @keyframes is a block at-rule). Only '
      + 'css accepts it, via its permissive generic at-rule STATEMENT arm. All three supersets '
      + 'refuse. OWNER RULING: this is css over-accepting, not three supersets under-accepting.'
  },
  {
    name: 'targeted:@scope without a block',
    accepted: ['css', 'less'],
    validCss: false,
    reason:
      '`@scope (.a);` is not valid CSS (css-cascade-6 §3 — @scope is a block at-rule). css and less '
      + 'accept via the permissive statement arm; scss and jess refuse. Same OWNER RULING as the '
      + 'rest of the "without a block" family.'
  },
  {
    name: 'targeted:@property without a block',
    accepted: ['css', 'less'],
    validCss: false,
    reason:
      '`@property --x;` is not valid CSS (css-properties-values-api-1 §2 — @property is a block '
      + 'at-rule). css and less accept; scss and jess refuse. Same OWNER RULING.'
  },
  {
    name: 'targeted:@font-face without a block',
    accepted: ['css', 'less', 'jess'],
    validCss: false,
    reason:
      '`@font-face;` is not valid CSS (css-fonts-4 §11). scss alone refuses — consistent with Sass+ '
      + 'deliberately rejecting invalid CSS. Same OWNER RULING.'
  },
  {
    name: 'targeted:@counter-style without a block',
    accepted: ['css', 'less', 'jess'],
    validCss: false,
    reason:
      '`@counter-style a;` is not valid CSS (css-counter-styles-3 §2). scss alone refuses. Same '
      + 'OWNER RULING.'
  },
  {
    name: 'targeted:@page without a block',
    accepted: ['css', 'less', 'jess'],
    validCss: false,
    reason: '`@page;` is not valid CSS (css-page-3 §3). scss alone refuses. Same OWNER RULING.'
  },
  {
    name: 'targeted:@starting-style without a block',
    accepted: ['css', 'less', 'jess'],
    validCss: false,
    reason:
      '`@starting-style;` is not valid CSS (css-transitions-2 §4). scss alone refuses. Same OWNER '
      + 'RULING.'
  },

  /* ------------------------------------------------------------- breadth
   * Whole real stylesheets. This channel names the FILE, not the construct:
   * a file is one row and one construct anywhere in it flips the verdict. The
   * causes below are deliberately NOT attributed — the gate prints each
   * refusing dialect's first unconsumed offset and the line at it on failure,
   * which is where attribution should come from, not from a guess written into
   * an allowlist. The targeted channel is what isolates constructs.
   */
  {
    name: 'breadth:fixture/calc-at-rule-prelude.css',
    accepted: ['css', 'less'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/fns/test/files/alias.css',
    accepted: ['css', 'less', 'jess'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/fns/test/files/color.css',
    accepted: ['css', 'less', 'jess'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/jess/benchmark/benchmark.css',
    accepted: ['css', 'less', 'scss'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/jess/test/files/import-func.css',
    accepted: ['css', 'less', 'jess'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/atrule-decls.css',
    accepted: ['css', 'less', 'scss'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/between.css',
    accepted: ['css', 'less', 'jess'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/escape.css',
    accepted: ['css'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/function.css',
    accepted: ['css', 'less'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/ie-progid.css',
    accepted: ['css'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/important.css',
    accepted: ['css', 'less'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/legacy-prop.css',
    accepted: ['css', 'less', 'jess'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/prop.css',
    accepted: ['css', 'less', 'jess'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/raw-decl.css',
    accepted: ['css', 'less', 'scss'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  },
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/selector.css',
    accepted: ['css', 'less', 'jess'],
    validCss: 'n/a — whole file',
    reason: 'Whole-file breadth row; construct not isolated by this channel.'
  }
];

/* ------------------------------------------------------------------ DIRECTION 2
 * All three supersets accept and `css` refuses. The CSS-BASE GAP detector.
 *
 * EMPTY, and that is a real result rather than an unbuilt check. The four
 * `@namespace url(http://x);` rows that populated it were closed by `d5c8f72bb`
 * while this gate was being written — see the calibration test, which reverts
 * that commit and watches all four come back. The breadth channel has never
 * contributed a row: no real stylesheet reaches a CSS-base gap, which is exactly
 * why the targeted channel exists and why an empty allowlist here is worth
 * something.
 *
 * Direction 2 is therefore a HARD gate: any new entry is a missing CSS rule.
 */
const DIRECTION_2_ALLOWLIST: readonly Allowed[] = [];

/* ---------------------------------------------------------------------- CRASHES
 * A reducer invariant that BLEW UP rather than declining the input. This is a
 * third outcome, not a flavour of reject: recognising less than the language is
 * a grammar gap, crashing on it is a defect of a different kind, and the public
 * `parse()` contract promises a `SyntaxError` rather than an internal `Error`.
 *
 * Named, like everything else here, so a NEW crash fails and a FIXED one fails
 * too. Found by this gate, recorded rather than fixed.
 */
const CRASH_ALLOWLIST: readonly Allowed[] = [
  {
    name: 'breadth:repo/packages/syntax/css/css-parser/test/css/errors/atrule-numeric-name.css',
    accepted: [],
    validCss: false,
    reason:
      '`@1foo { }` — the less grammar THROWS "This Less variable name is not supported." instead of '
      + 'declining the input. css, scss and jess all reject it cleanly. The input is not valid CSS, '
      + 'so no direction is violated and the file does not appear in either allowlist above — which '
      + 'is exactly why the crash needs its own channel to be visible at all. Related to the open '
      + 'question of whether the less parser should accept a leading-digit variable name.'
  }
];

/** Build every row of the matrix once. */
function buildRows(): { rows: Row[]; bootstrapVersion: string; breadthNames: string[] } {
  const rows: Row[] = [];

  /*
   * Both targeted families share the `targeted:` name prefix, so an allowlist
   * entry reads the same whichever channel found it. The ids are asserted
   * globally unique below, which is what keeps that safe.
   */
  for (const probe of [...TARGETED_PROBES, ...VALUE_PROBES]) {
    rows.push({
      name: `targeted:${probe.id}`,
      channel: 'targeted',
      source: probe.source,
      accepted: DIALECTS.filter(d => parseVerdict(d, probe.source).parses)
    });
  }

  const { entries, bootstrapVersion } = buildCorpus();
  const breadthNames: string[] = [];
  for (const entry of entries) {
    const source = readEntry(entry);
    breadthNames.push(entry.id);
    rows.push({
      name: `breadth:${entry.id}`,
      channel: 'breadth',
      source,
      accepted: DIALECTS.filter(d => parseVerdict(d, source).parses)
    });
  }

  return { rows, bootstrapVersion, breadthNames };
}

const { rows, bootstrapVersion, breadthNames } = buildRows();
const byName = new Map(rows.map(row => [row.name, row]));

/** Where a dialect refused, as `offset` plus the source line at it. */
function refusalSite(source: string, dialect: Dialect): string {
  const verdict = parseVerdict(dialect, source);
  if (verdict.crashed !== undefined) {
    return `${dialect}: CRASHED ${verdict.crashed}`;
  }
  const at = verdict.unconsumedFrom;
  if (at === null) {
    return `${dialect}: recovered=${verdict.recovered} (no unconsumed offset)`;
  }
  const lineStart = source.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = source.indexOf('\n', at) === -1 ? source.length : source.indexOf('\n', at);
  const line = source.slice(lineStart, lineEnd).trim().slice(0, 120);
  return `${dialect}: refused at offset ${at} — ${JSON.stringify(line)} — expected `
    + JSON.stringify(verdict.expected.slice(0, 6));
}

/** Render observed violations so a failure names the construct AND the site. */
function describeViolations(violations: readonly Row[], refusers: (row: Row) => readonly Dialect[]): string {
  return violations
    .map(row =>
      `\n  ${row.name}\n    accepted: [${row.accepted.join(', ')}]\n`
      + `    source: ${JSON.stringify(row.source.length > 160 ? `${row.source.slice(0, 160)}…` : row.source)}\n`
      + refusers(row).map(d => `    ${refusalSite(row.source, d)}`).join('\n'))
    .join('\n');
}

describe('cross-dialect acceptance matrix', () => {
  it('names its corpus, and every declared at-keyword is probed', () => {
    /*
     * Names, not counts. A ratchet keyed on a count reads a file silently
     * dropping out of the corpus as a slightly smaller number; keyed on names
     * it reads as a failure. Bootstrap's version is reported rather than
     * pinned, because its id deliberately excludes the pnpm content hash.
     */
    expect(DIALECTS).toEqual(['css', 'less', 'scss', 'jess']);
    expect(TARGETED_PROBES.length).toBeGreaterThan(0);
    expect(breadthNames.length).toBeGreaterThan(0);

    const probeIds = [...TARGETED_PROBES, ...VALUE_PROBES].map(p => p.id);
    expect(new Set(probeIds).size, 'duplicate targeted probe id').toBe(probeIds.length);
    expect(new Set(breadthNames).size, 'duplicate breadth corpus id').toBe(breadthNames.length);

    /* Every spec at-keyword must have at least one probe, or the enumeration is
     * decorative: this is the check `@keyframes` failed for the whole repo. */
    const unprobed = AT_KEYWORDS.filter(k => !TARGETED_PROBES.some(p => p.atKeyword === k));
    expect(unprobed, `at-keywords with no probe: ${unprobed.join(', ')}`).toEqual([]);

    /*
     * Same check for the value channel. Its axes are the CSS value atom kinds,
     * and each must be probed in BOTH ladders — a dialect can drop an arm from
     * its bare value choice and not its calc rung, or the reverse, and jess's
     * `<urange>` gap was invisible until both were asked.
     */
    const unprobedAxes = VALUE_AXES.filter(axis => !VALUE_PROBES.some(p => p.axis === axis));
    expect(unprobedAxes, `value axes with no probe: ${unprobedAxes.join(', ')}`).toEqual([]);
    for (const position of ['bare', 'math-argument'] as const) {
      expect(
        VALUE_PROBES.some(p => p.position === position),
        `no value probe in the ${position} ladder`
      ).toBe(true);
    }

    console.log(
      `[acceptance-matrix] ${TARGETED_PROBES.length} at-rule probes over ${AT_KEYWORDS.length} at-keywords`
      + ` + ${VALUE_PROBES.length} value probes over ${VALUE_AXES.length} axes`
      + ` + ${breadthNames.length} breadth stylesheets (bootstrap ${bootstrapVersion})`
      + ` x ${DIALECTS.length} dialects = ${rows.length * DIALECTS.length} verdicts`
    );
  });

  it('CALIBRATION — the three known positives are expressible and correctly scored', () => {
    /*
     * A gate that passes because its corpus cannot express the failure is the
     * exact failure mode this file exists to avoid. Both known positives must
     * be PRESENT as rows, and each must score the way it actually behaves.
     */
    const prologue = byName.get('targeted:@charset then @import — the canonical prologue');
    expect(prologue, 'known positive 1 is not in the corpus').toBeDefined();
    /* Fixed at 7d32a7fca. Calibrated by deleting that commit's
     * `optional(g.CharsetStatement)` arm from the CSS Stylesheet sequence, at
     * which point this row scored [less, scss, jess] and direction 2 FAILED on
     * it; the arm was restored. Green here means the fix is still in place. */
    expect(prologue!.accepted, 'the @charset/@import prologue regressed').toEqual(['css', 'less', 'scss', 'jess']);

    /*
     * Known positive 2, `@namespace url(http://x);` — css-namespaces-3 §2 admits
     * <url> as well as <string>. It was a LIVE direction-2 violation found by
     * this gate with nothing reverted, and was then closed by `d5c8f72bb` while
     * this file was being written. Calibrated the same way as the prologue:
     * restoring that commit's two lines to their previous inline spelling —
     *
     *   token(balancedParens)   -> token(balanced('(', ')'))
     *   token(balancedBrackets) -> token(balanced('[', ']'))
     *
     * in `AtRulePreludeGroup` — brought back exactly these four rows and no
     * others, and direction 2 reported them; reverting the revert emptied it
     * again. Worth knowing what the defect actually was: NOT namespaces and NOT
     * url(), but a lone `/` inside ANY bracketed group in a statement prelude,
     * which `http://x` happens to contain.
     *
     * All four spellings are kept as probes so the fix cannot silently regress.
     */
    for (const name of [
      'targeted:@namespace url() unquoted',
      'targeted:@namespace prefixed url() unquoted',
      'targeted:@namespace url() unquoted after a rule',
      'targeted:@namespace url() unquoted after @charset'
    ]) {
      const row = byName.get(name);
      expect(row, `known positive 2 is not in the corpus: ${name}`).toBeDefined();
      expect(row!.accepted, `the @namespace url() CSS-base gap reopened: ${name}`)
        .toEqual(['css', 'less', 'scss', 'jess']);
    }

    /*
     * Known positive 3, `<urange>` — css-syntax-3 §4.3.15 / css-values-4 §3.4.
     * `min(U+0-7F)` scored `css/less/scss accept, jess reject` — a DIRECTION 1
     * violation over plain CSS — while this gate was fully green, because the
     * corpus was at-rules only and could not express a value at all. That is
     * the failure mode the calibration doctrine exists to catch, so the
     * construct is pinned here and not merely allowlisted.
     *
     * The defect was NOT the math-function argument list: jess had no
     * `<urange>` production at all, so the BARE row failed identically. Both
     * ladders are asserted for that reason — a fix applied to one only would
     * leave the other red. Calibrated by deleting `g.UnicodeRange` from jess's
     * `nonBlockValueAtom` and `CalcValue` choices: the bare and math rows
     * returned to `[css, less, scss]` and direction 1 failed on them, plus two
     * breadth files (`fixture/calc-operand-kinds.css`,
     * `css-parser/test/css/font-face.css`) whose real `unicode-range`
     * declarations this same fix closed.
     */
    for (const name of [
      'targeted:urange bare',
      'targeted:urange in unicode-range',
      'targeted:urange in min() — the measured violation',
      'targeted:urange in calc()'
    ]) {
      const row = byName.get(name);
      expect(row, `known positive 3 is not in the corpus: ${name}`).toBeDefined();
      expect(row!.accepted, `the <urange> superset violation reopened: ${name}`)
        .toEqual(['css', 'less', 'scss', 'jess']);
    }
  });

  it('DIRECTION 1 — css accepts ⇒ all three supersets accept', () => {
    const violations = rows.filter(
      row => row.accepted.includes('css') && !SUPERSETS.every(d => row.accepted.includes(d))
    );

    /*
     * SET EQUALITY, not a threshold and not a count. A NEW violation fails
     * because it is not in the allowlist; a FIXED one fails too, because a
     * stale pin is how an allowlist rots into a permanent exemption. The
     * accepted-dialect set is part of the pin, so a violation that changes
     * shape is a failure rather than a quiet re-classification.
     */
    const observed = violations.map(row => `${row.name} :: [${row.accepted.join(', ')}]`).sort();
    const allowed = DIRECTION_1_ALLOWLIST.map(a => `${a.name} :: [${a.accepted.join(', ')}]`).sort();

    expect(
      observed,
      'DIRECTION 1 violations changed. Every entry below is `name :: [dialects that accept]`.\n'
      + 'A NEW name = a regression. A MISSING name = a fix; delete its allowlist entry.\n'
      + describeViolations(violations, row => SUPERSETS.filter(d => !row.accepted.includes(d)))
    ).toEqual(allowed);
  });

  it('DIRECTION 2 — all three supersets accept ⇒ css accepts (CSS-BASE GAP)', () => {
    const violations = rows.filter(
      row => !row.accepted.includes('css') && SUPERSETS.every(d => row.accepted.includes(d))
    );

    const observed = violations.map(row => `${row.name} :: [${row.accepted.join(', ')}]`).sort();
    const allowed = DIRECTION_2_ALLOWLIST.map(a => `${a.name} :: [${a.accepted.join(', ')}]`).sort();

    expect(
      observed,
      'DIRECTION 2 violations changed — a construct all three supersets accept and css does not is '
      + 'close to a proof of a MISSING CSS RULE.\n'
      + describeViolations(violations, () => ['css'])
    ).toEqual(allowed);
  });

  it('every allowlist entry names a row that exists, and carries a reason', () => {
    /*
     * An allowlist entry whose name no longer matches any row would silently
     * exempt nothing while looking like tracked debt — the same rot the set
     * equality above prevents, one level up.
     */
    const all = [...DIRECTION_1_ALLOWLIST, ...DIRECTION_2_ALLOWLIST, ...CRASH_ALLOWLIST];
    for (const entry of all) {
      expect(byName.has(entry.name), `allowlist names a row that does not exist: ${entry.name}`).toBe(true);
      expect(entry.reason.length, `allowlist entry has no reason: ${entry.name}`).toBeGreaterThan(40);
    }

    const d1d2 = [...DIRECTION_1_ALLOWLIST, ...DIRECTION_2_ALLOWLIST].map(e => e.name);
    expect(new Set(d1d2).size, 'duplicate allowlist entry').toBe(d1d2.length);
  });

  it('reports a parse CRASH separately from a reject', () => {
    /*
     * A reducer invariant blowing up is a third outcome, not a flavour of
     * reject, and collapsing the two is how it stays invisible. No input in
     * this corpus may crash any grammar.
     */
    const crashes: string[] = [];
    for (const row of rows) {
      for (const dialect of DIALECTS) {
        const verdict = parseVerdict(dialect, row.source);
        if (verdict.crashed !== undefined) {
          crashes.push(`${row.name} → ${dialect}: ${verdict.crashed}`);
        }
      }
    }
    /* Set equality against the named allowlist, for the same reason as the two
     * directions: a threshold would let a new crash hide behind a known one. */
    expect(
      crashes.map(c => c.split(' → ')[0]).sort(),
      `crashing rows changed:\n${crashes.join('\n')}`
    ).toEqual(CRASH_ALLOWLIST.map(a => a.name).sort());
  });
});
