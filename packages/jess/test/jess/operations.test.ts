/*
 * The §4 expected table of `docs/design/OPERATIONS.md`, executable.
 *
 * That document is SETTLED — every semantic question in it is decided — and
 * until this file existed there was NO `.jess` comparison assertion anywhere in
 * the suite, which is why 22 of 22 comparison rows could be wrong without a
 * single test going red (OPERATIONS.md §7.1).
 *
 * This file is the ratchet the plan's Phase 0 asks for: it states the TARGET
 * for every row, and a row that does not reach the target yet is marked
 * `it.fails` with a `PENDING` title naming the phase that closes it. `it.fails`
 * is the right marker rather than a pin of the current bytes, because it goes
 * RED the moment the row starts passing — so landing a phase forces the marker
 * off, and nobody has to remember to come back.
 *
 * Do NOT weaken a row to match what we emit. The table is the spec; the code is
 * what is wrong.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/** Render one `.jess` declaration value and return just the value bytes. */
const value = async (expr: string) => {
  const out = await new Compiler().renderString(`.a { k: ${expr}; }`, {
    filePath: 'entry.jess',
    extension: '.jess'
  });
  return out.replace(/\s+/g, ' ').trim().replace(/^\.a \{ k: /, '').replace(/; \}$/, '');
};

/** Render a whole `.jess` body, for rows that need a binding first. */
const body = async (src: string) => {
  const out = await new Compiler().renderString(`.a { ${src} }`, {
    filePath: 'entry.jess',
    extension: '.jess'
  });
  return out.replace(/\s+/g, ' ').trim();
};

/**
 * The §4.7 ladder is a COMPILE-level option, so it is set on the Compiler and not
 * per render. These two helpers differ only in what they observe — the bytes, and
 * the warnings the render reports to its CALLER — because §4.7 makes a claim about
 * BOTH ("every rung warns except the one that throws") and a row that checked only
 * the bytes is exactly how the silent rungs stayed silent.
 */
type UnitMode = 'loose' | 'preserve' | 'strict';

const valueIn = async (expr: string, unitMode: UnitMode) => {
  const out = await new Compiler({ compile: { unitMode }, quiet: true })
    .renderString(`.a { k: ${expr}; }`, { filePath: 'entry.jess', extension: '.jess' });
  return out.replace(/\s+/g, ' ').trim().replace(/^\.a \{ k: /, '').replace(/; \}$/, '');
};

/**
 * The warning CODES that reach a caller. `renderToResult` is the existing channel
 * for eval-time diagnostics on a source string (`safeRender` is the same channel
 * for a file); nothing new is introduced here.
 */
const warningsIn = async (expr: string, unitMode: UnitMode) => {
  const { warnings } = await new Compiler({ compile: { unitMode }, quiet: true })
    .renderToResult(
      { source: `.a { k: ${expr}; }`, filePath: 'entry.jess', extension: '.jess' },
      { quiet: true }
    );
  return warnings.map(w => w.code);
};

/** Render a whole stylesheet in the named dialect. */
const sheet = async (src: string, extension: '.jess' | '.scss' | '.less') => {
  const out = await new Compiler().renderString(src, { filePath: `entry${extension}`, extension });
  return out.replace(/\s+/g, ' ').trim();
};

/**
 * Whether a condition took its TRUE branch, in each dialect's own construct.
 * The branch body is the only observable, so a falsy condition renders NOTHING —
 * which is what an empty string here means.
 */
const jessTruthy = async (v: string) => (await sheet(`$x: ${v}; $if ($x) { .a { k: T } }`, '.jess')) !== '';
const scssTruthy = async (v: string) => (await sheet(`$x: ${v}; @if $x { .a { k: T } }`, '.scss')) !== '';
const lessTruthy = async (v: string) => (await sheet(`@x: ${v}; .m() when (@x) { k: T } .a { .m(); }`, '.less')) !== '';

describe('OPERATIONS §4 — arithmetic', () => {
  it('folds commensurate arithmetic (rows a-e)', async () => {
    await expect(value('$(1 + 2)')).resolves.toBe('3');
    await expect(value('$(1 + 2px)')).resolves.toBe('3px');
    await expect(value('$(1px + 2)')).resolves.toBe('3px');
    await expect(value('$(1 * 2px)')).resolves.toBe('2px');
    await expect(value('$(1px * 2)')).resolves.toBe('2px');
  });

  it('divides where division is written (row g)', async () => {
    await expect(value('$(1px / 2)')).resolves.toBe('0.5px');
  });

  it('a reciprocal unit is not expressible, so `1 / 2px` preserves (row h)', async () => {
    /*
     * There is no `px⁻¹` in CSS. Less 4.x answers `0.5px`, which is
     * dimensionally false. Under the DEFAULT `preserve` mode the honest outcome
     * is the preserved expression plus a warning; `loose` gives Less's answer
     * plus a warning; `strict` throws. No rung is silent (§4.7).
     */
    await expect(value('$(1 / 2px)')).resolves.toBe('calc(1 / 2px)');
  });

  it('a unit product preserves rather than fabricating (rows f, f2, f3)', async () => {
    /*
     * `1px * 2px` is an area, and CSS has no area unit; `1px * 10%` does not
     * commensurate at all. Less 4.x answers `2px` / `10px` — dimensionally
     * false. We preserve and warn (§4.7), and preserve AUTHORED order, so
     * `10% * 1px` does not come back reordered the way dart-sass reorders it.
     */
    await expect(value('$(1px * 2px)')).resolves.toBe('calc(1px * 2px)');
    await expect(value('$(1px * 10%)')).resolves.toBe('calc(1px * 10%)');
    await expect(value('$(10% * 1px)')).resolves.toBe('calc(10% * 1px)');
  });

  it('like units cancel to a unitless number (row g2)', async () => {
    await expect(value('$(2px / 1px)')).resolves.toBe('2');
  });

  it('a math function preserves its authorship (rows h3, h4)', async () => {
    /*
     * §4.6: an operation authored inside a CSS math function does not fold —
     * operands resolve so the variable substitutes, and the operation returns
     * intact. `$( … )` is the explicit opt-in to fold, and a `calc()` whose
     * sole argument folds to one value unwraps.
     */
    await expect(body('$val: 8px; k: calc($val / 2);')).resolves.toBe('.a { k: calc(8px / 2); }');
    await expect(body('$val: 8px; k: calc($($val / 2));')).resolves.toBe('.a { k: 4px; }');
    await expect(body('k: calc(2px * 3);')).resolves.toBe('.a { k: calc(2px * 3); }');
  });

  it('non-calc math functions parse and preserve (§3.6)', async () => {
    /*
     * §6 closed this. The base grammar used to reach its math ladder only
     * through `calc()`, so `min(100% - 30px)` was a parse error in `css` and
     * `jess` while `less` and `scss` accepted it — the base rejecting what its
     * supersets accept. All twenty-one css-values-4 §10 names now share one
     * dispatch arm and one argument grammar.
     */
    await expect(value('min(100% - 30px)')).resolves.toBe('min(100% - 30px)');
    await expect(value('min(1em - 2px)')).resolves.toBe('min(1em - 2px)');
  });
});

describe('OPERATIONS §4.7 — the `unitMode` ladder, and NO rung is silent', () => {
  /*
   * The rows above assert the DEFAULT rung only, and that is precisely how this
   * section stayed broken while reading as done: `preserve` was right, so the
   * table looked green, while `strict` silently answered `0.5px` and not one rung
   * warned. A settled behaviour with no row can regress without going red — these
   * rows exist to make the other two rungs, and the warning, unregressable.
   *
   * "Nonsensical" is §4.7's own definition and nothing wider: a result whose unit
   * CSS CANNOT EXPRESS — a unit PRODUCT (`1px * 2px`) or a bare RECIPROCAL
   * (`1 / 2px`). A result that is expressible is not a §4.7 case in ANY mode, which
   * is what the last row below pins.
   */

  const unexpressible = ['$(1 / 2px)', '$(1px * 2px)', '$(1px * 10%)'];

  it('`strict` THROWS on an unexpressible unit — on `*` and `/`, not just `+`/`-`', async () => {
    /*
     * The defect this file exists to catch. `dimensionOperate` consulted
     * `unitMode` only on the `+`/`-` conversion path, and the `*`//` composition
     * reached the consuming boundary through the `$( … )` splice, which folded it
     * to bytes before the boundary could see a typed dimension — so `strict` fell
     * through to the raw magnitude.
     */
    for (const expr of unexpressible) {
      await expect(valueIn(expr, 'strict'), `${expr} must throw under strict`).rejects.toThrow();
    }
  });

  it('`strict` raises the STRUCTURED unit error, not a bare TypeError', async () => {
    /*
     * The code and a source location are the contract, not merely "it threw" —
     * a bare `TypeError` out of the public API would satisfy the row above.
     */
    await expect(valueIn('$(1 / 2px)', 'strict')).rejects.toMatchObject({
      code: 'eval/invalid-unit-arithmetic'
    });
  });

  it('`loose` gives Less 4.x\'s answer — the rung that folds', async () => {
    /*
     * Dimensionally false on purpose: `loose` is the opt-in to Less 4.x's
     * behaviour, which is why it is the rung that most needs the warning.
     */
    await expect(valueIn('$(1 / 2px)', 'loose')).resolves.toBe('0.5px');
    await expect(valueIn('$(1px * 2px)', 'loose')).resolves.toBe('2px');
  });

  it('`preserve` (default) says the expression back, and does NOT raise', async () => {
    await expect(valueIn('$(1 / 2px)', 'preserve')).resolves.toBe('calc(1 / 2px)');
    await expect(valueIn('$(1px * 2px)', 'preserve')).resolves.toBe('calc(1px * 2px)');
  });

  it('NO MODE IS SILENT — both non-throwing rungs warn, and it REACHES the caller', async () => {
    /*
     * The half of §4.7 that had zero assertions anywhere in the suite. Silent
     * preservation is the worst outcome: the author gets output that looks fine
     * and never learns the expression was meaningless (ledger G25 — "auto-fixed
     * AND warned — both, not either").
     *
     * `strict` is excluded because it throws instead, which is the one rung §4.7
     * says says nothing extra.
     */
    for (const mode of ['loose', 'preserve'] as const) {
      for (const expr of unexpressible) {
        await expect(warningsIn(expr, mode), `${expr} must warn under ${mode}`)
          .resolves.toContain('eval/unexpressible-unit');
      }
    }
  });

  it('an EXPRESSIBLE result is silent in every rung — the warning is not a blanket', async () => {
    /*
     * The bound on the row above. Units that cancel (`2px / 1px` → `2`) or a plain
     * scaling (`1px * 2`) are honestly expressible, so they neither throw nor warn
     * anywhere on the ladder. Without this row the warning could be emitted for
     * every operation and the previous row would still pass.
     */
    for (const mode of ['loose', 'preserve', 'strict'] as const) {
      await expect(valueIn('$(2px / 1px)', mode)).resolves.toBe('2');
      await expect(valueIn('$(1px * 2)', mode)).resolves.toBe('2px');
      await expect(warningsIn('$(2px / 1px)', mode)).resolves.toEqual([]);
      await expect(warningsIn('$(1px * 2)', mode)).resolves.toEqual([]);
    }
  });

  it('an unexpressible INTERMEDIATE that cancels back is not a §4.7 case', async () => {
    /*
     * §4.7 is a question about a FINAL value, asked at the consuming boundary. The
     * ladder keeps computing through an unexpressible step so a later operation can
     * cancel it, and `1px * 1px / 1px` is an honest `1px` — warning about the
     * `1px * 1px` inside it would be a false positive about an expression the
     * author got right, and throwing on it would break the chain outright.
     */
    for (const mode of ['loose', 'preserve', 'strict'] as const) {
      await expect(valueIn('$(1px * 1px / 1px)', mode)).resolves.toBe('1px');
      await expect(warningsIn('$(1px * 1px / 1px)', mode)).resolves.toEqual([]);
    }
  });
});

describe('OPERATIONS §4 — loose equality `=`', () => {
  it('numeric ground: a unitless side is a wildcard (rows i, j, j2, k, l)', async () => {
    await expect(value('$(1 = 2)')).resolves.toBe('false');
    await expect(value('$(1 = 1px)')).resolves.toBe('true');
    await expect(value('$(1em = 1px)')).resolves.toBe('false');
    await expect(value('$(2 = 1px)')).resolves.toBe('false');
    await expect(value('$(2 = 2%)')).resolves.toBe('true');
  });

  it('string ground: a value equals its own spelling (rows q, r, s)', async () => {
    await expect(value('$(a = b)')).resolves.toBe('false');
    await expect(value('$(a = "a")')).resolves.toBe('true');
    await expect(value('$(a = a)')).resolves.toBe('true');
  });

  it('colour ground is rgb + alpha (rows v, w, x, y, z)', async () => {
    await expect(value('$(red = red)')).resolves.toBe('true');
    await expect(value('$(black = transparent)')).resolves.toBe('false');
    await expect(value('$(black = #000000)')).resolves.toBe('true');
    await expect(value('$(black = #00000000)')).resolves.toBe('false');
    await expect(value('$(black = #000000FF)')).resolves.toBe('true');
  });

  it('§4.1 — the ground is picked ONCE, per pair, and nothing is transitive', async () => {
    /*
     * `1 = 1px` compares on numeric ground and `1 = "1px"` on string ground.
     * Different pairs, different grounds, no contradiction — and Less's `=` is
     * already non-transitive without any of this (`1 = 1px` and `1 = 1em` are
     * both true on lessc 4.6.3 while `1px = 1em` is false).
     */
    await expect(value('$(1 = "1")')).resolves.toBe('true');
    await expect(value('$(1px = "1px")')).resolves.toBe('true');
    await expect(value('$(1 = "1px")')).resolves.toBe('false');
    await expect(value('$(red = "red")')).resolves.toBe('true');
  });

  it('§4.1 — with no common ground, equality is false and never raises', async () => {
    await expect(value('$(1px = red)')).resolves.toBe('false');
  });
});

describe('OPERATIONS §4 — type-equal `==`', () => {
  it('`==` additionally requires the same type (rows j1, l1, r1)', async () => {
    /*
     * Unitless is its OWN type — it is the wildcard that makes `=` loose, and
     * `==` is exactly the operator that declines the wildcard.
     */
    await expect(value('$(1 == 1px)')).resolves.toBe('false');
    await expect(value('$(2 == 2%)')).resolves.toBe('false');
    await expect(value('$(a == "a")')).resolves.toBe('false');
  });

  it('`==` agrees with `=` where the types already match', async () => {
    await expect(value('$(1px == 1px)')).resolves.toBe('true');
    await expect(value('$(a == a)')).resolves.toBe('true');
    await expect(value('$(1 == 1)')).resolves.toBe('true');
    await expect(value('$(red == red)')).resolves.toBe('true');
  });

  it('for a dimension the TYPE is the unit group, so compatible units convert', async () => {
    await expect(value('$(1in == 96px)')).resolves.toBe('true');
  });

  it('colour ground, and `1in = 2.54cm` (O-TRUTH-3)', async () => {
    /*
     * `black == #000000` needs the §4.1 COLOUR ground: `black` is a Keyword
     * against a Color, and only the ground model makes the pair compare as
     * colours at all. `1in = 2.54cm` is equal BY DEFINITION — lessc 4.6.3's
     * `false` is a conversion-precision bug, not a dialect choice, and it is
     * the one row where diverging from Less 4.x needs no further
     * justification. Both close with phase 4.
     */
    await expect(value('$(black == #000000)')).resolves.toBe('true');
    await expect(value('$(1in == 2.54cm)')).resolves.toBe('true');
    await expect(value('$(1in = 2.54cm)')).resolves.toBe('true');
  });
});

describe('OPERATIONS §4.2 — relational is trichotomous', () => {
  it('numeric ground (rows m, n, o, p)', async () => {
    await expect(value('$(1 > 2)')).resolves.toBe('false');
    await expect(value('$(2 > 1)')).resolves.toBe('true');
    await expect(value('$(1 > 1px)')).resolves.toBe('false');
    await expect(value('$(1 >= 1px)')).resolves.toBe('true');
    await expect(value('$(1in > 1cm)')).resolves.toBe('true');
  });

  it('string ground is lexicographic, so `a > b` and `b > a` are not BOTH false (rows t, u)', async () => {
    /*
     * Row `u` is the amendment of §4.2. lessc 4.6.3 answers `false` to both,
     * which is the clearest case in the document where an engine's behaviour is
     * a defect rather than a dialect: an author cannot distinguish "genuinely
     * not greater" from "never comparable".
     */
    await expect(value('$(a > b)')).resolves.toBe('false');
    await expect(value('$(b > a)')).resolves.toBe('true');
    await expect(value('$("b" > "a")')).resolves.toBe('true');
    await expect(value('$("a" > "b")')).resolves.toBe('false');
  });

  it('with no common ground, relational ERRORS — unlike equality', async () => {
    await expect(value('$(1px > red)')).rejects.toThrow();
  });

  /*
   * §4.2a — A GROUNDLESS RELATIONAL IS ONE RULE WITH TWO ANSWERS, and both halves
   * need a row. In VALUE position it is an assertion, so it RAISES; in GUARD
   * position a comparison is a MATCH TEST, so it is a NON-MATCH and nothing is
   * emitted. Only the value half was asserted (directly above), and the guard half
   * appeared only incidentally, as the CONTROL inside the §4.5.5 short-circuit
   * rows — where it is load-bearing for a different claim and would not go red for
   * the right reason if §4.2a itself regressed.
   */

  it('§4.2a — in VALUE position a groundless relational raises the STRUCTURED error', async () => {
    await expect(value('$(1px > red)')).rejects.toMatchObject({
      code: 'eval/incomparable-operands'
    });
    await expect(sheet('@if (1px > red) { .a { k: OK } }', '.scss')).rejects.toMatchObject({
      code: 'eval/incomparable-operands'
    });
  });

  it('§4.2a — in `.less` GUARD position the same comparison is a NON-MATCH, not an error', async () => {
    /*
     * Paired with a guard that DOES match, so the row cannot pass against an engine
     * where no guard ever matches — which is what "emits nothing" would otherwise
     * be indistinguishable from.
     */
    await expect(sheet('.m() when (1px > red) { k: OK } .a { .m(); }', '.less')).resolves.toBe('');
    await expect(sheet('.m() when (2px > 1px) { k: OK } .a { .m(); }', '.less')).resolves.toBe('.a { k: OK; }');
  });
});

describe('OPERATIONS §4.5.2 — a comparison is an ordinary value, including as a call argument', () => {
  it('a comparison folds to its boolean in ARGUMENT position', async () => {
    /*
     * The row that proves the comparison is a value and not a construct the
     * grammar only admits in a condition slot. `if()` is a CSS math-family
     * function, so it PRESERVES its authorship (§4.6) — the observable is that the
     * argument came back as the folded `true`/`false`, not that `if()` resolved.
     */
    await expect(value('if($(1 < 2), red, blue)')).resolves.toBe('if(true, red, blue)');
    await expect(value('if($(2 < 1), red, blue)')).resolves.toBe('if(false, red, blue)');
  });
});

describe('OPERATIONS §4.3 — `null` elides, and `$( … )` is TRANSPARENT to that', () => {
  /*
   * The §4.3 table, measured on dart-sass 1.101.0, plus the row it did not state
   * because it is jess-only: a `null` reaching the same position THROUGH the
   * `$( … )` computation boundary must behave identically to a bare `null`. The
   * boundary owns no output delimiters (§12.6), so it owns no value either — it
   * cannot turn an ABSENT value into empty bytes.
   *
   * This was a real defect: the jess grammar wraps `Expression` in a single-ref
   * `Interpolation`, which folded its ref straight to bytes and lost the
   * elision fact. The declaration emitted `k: ;` and the list forms left the
   * dropped member's separator behind (`1px  2px`, `1px, , 2px`). Every
   * assertion below is written as the bare-`null` form AND the `$( … )` form so
   * a regression on either side goes red.
   */

  it('a whole-value `null` DROPS the declaration, through the boundary too', async () => {
    await expect(body('k: null; c: red')).resolves.toBe('.a { c: red; }');
    await expect(body('k: $(null); c: red')).resolves.toBe('.a { c: red; }');
  });

  it('an `and`/`or` folding to `null` drops it too — the boundary, not the operator', async () => {
    /*
     * `$(null and 2)` short-circuits to the `null` OPERAND (§4.5.5), so it is
     * the same row as above. It is asserted separately because it is what
     * proves the defect was the boundary and not `and`.
     */
    await expect(body('k: $(null and 2); c: red')).resolves.toBe('.a { c: red; }');
  });

  it('an elided member takes its separator with it, through the boundary too', async () => {
    await expect(body('k: 1px null 2px')).resolves.toBe('.a { k: 1px 2px; }');
    await expect(body('k: 1px $(null) 2px')).resolves.toBe('.a { k: 1px 2px; }');
    await expect(body('k: 1px $(null and 2) 2px')).resolves.toBe('.a { k: 1px 2px; }');

    await expect(body('k: 1px, null, 2px')).resolves.toBe('.a { k: 1px, 2px; }');
    await expect(body('k: 1px, $(null), 2px')).resolves.toBe('.a { k: 1px, 2px; }');
  });

  it('an interpolation TEMPLATE keeps its literal bytes — `"v${x}"` is `"v"`, not a drop', async () => {
    /*
     * The §4.3 row that bounds the fix: a template with authored literal pieces
     * around the splice is real bytes, so it emits — only a template that is
     * ENTIRELY elided refs is absent.
     */
    await expect(sheet('$x: null; .a { k: "v${x}"; c: red }', '.jess')).resolves.toBe('.a { k: "v"; c: red; }');
  });
});

describe('OPERATIONS §4.4 — truthiness is EMPTINESS, not zero-ness', () => {
  /*
   * The falsy set is exactly four values — `false`, `null`, `""` (and `''`) and
   * the empty list/map — and EVERYTHING else is truthy. `0` is a real CSS value
   * (`margin: 0` means something), so it is not an absence and stays truthy.
   * That is where JavaScript is wrong for this domain, and where Sass is only
   * half right: it gets `0` right but calls `""` and `()` truthy too, with no
   * principle separating them from `null`.
   *
   * §4.4.6 makes `.scss` take this rule as well, so Sass+ and `.jess` agree.
   * `.less` keeps its own (`when (@x)` lowers to `@x == true`, §4.4.2), which is
   * why the `.less` rows below are a SEPARATE table and not a divergence.
   */

  it('`.jess` — falsy for exactly false / null / "" / \'\'', async () => {
    await expect(jessTruthy('false')).resolves.toBe(false);
    await expect(jessTruthy('null')).resolves.toBe(false);
    await expect(jessTruthy('""')).resolves.toBe(false);
    await expect(jessTruthy('\'\'')).resolves.toBe(false);

    /*
     * The `()` row. §12.6 rules that in `.jess` a paren is a literal paren and
     * NOT a list — `(1 2)` lowers to bare `1 2` — so the empty list/map this row
     * means is spelled `{}`, the empty Collection, and `()` itself is a parse
     * error in value position. `.scss` still spells it `()`, and that row is
     * asserted in the Sass+ table below.
     */
    await expect(jessTruthy('{}')).resolves.toBe(false);

    /*
     * The `[]` row (§12.6c). A bracketed list is a list, so the EMPTY one is
     * empty and the principle decides it — the fourth falsy member is emptiness,
     * not a single privileged spelling. It measured TRUTHY until the grammars
     * stopped reducing an empty bracket group to a block wrapping a contentless
     * `Any`, which minted content where the source has none.
     */
    await expect(jessTruthy('[]')).resolves.toBe(false);
    await expect(jessTruthy('[a]')).resolves.toBe(true);
  });

  it('`.jess` — `0` and every other non-empty value is TRUTHY', async () => {
    for (const v of ['true', '0', '0px', '0%', '"0"', '1', '-1', '0.0', '1em', 'red', '#000', 'transparent', 'rgba(0,0,0,0)', 'none', 'a', 'inherit', '"false"', '{a: b}']) {
      await expect(jessTruthy(v), `${v} must be truthy`).resolves.toBe(true);
    }
  });

  it('`.scss` — Sass+ takes the emptiness rule, so `""` and `()` are FALSY (§4.4.6)', async () => {
    await expect(scssTruthy('false')).resolves.toBe(false);
    await expect(scssTruthy('null')).resolves.toBe(false);
    await expect(scssTruthy('""')).resolves.toBe(false);
    await expect(scssTruthy('\'\'')).resolves.toBe(false);
    await expect(scssTruthy('()')).resolves.toBe(false);
    await expect(scssTruthy('[]')).resolves.toBe(false);
    await expect(scssTruthy('[a]')).resolves.toBe(true);
  });

  it('`.scss` — `null` must be the value-domain Null, not the identifier', async () => {
    /*
     * §4.4.6's PREREQUISITE, and it is not optional: `@if $x` lowers to the bare
     * truth node, so if `.scss` still minted `keyword('null')` in the value lane
     * `@if null` would silently take the TRUE branch. This row is what catches a
     * regression of the `NullLiteral` production.
     */
    await expect(scssTruthy('null')).resolves.toBe(false);
    await expect(sheet('$x: null; .a { k: $x; c: red }', '.scss')).resolves.toBe('.a { c: red; }');
  });

  it('`.scss` — `0` and every other non-empty value is TRUTHY', async () => {
    for (const v of ['true', '0', '0px', '0%', '"0"', '1', '-1', '0.0', '1em', 'red', '#000', 'transparent', 'rgba(0,0,0,0)', 'none', 'a', 'inherit', '"false"', '(1 2)', '(1, 2)', '(a: b)']) {
      await expect(scssTruthy(v), `${v} must be truthy`).resolves.toBe(true);
    }
  });

  it('`.less` keeps its OWN rule — `when (@x)` is `@x == true` (§4.4.2)', async () => {
    /*
     * Under `==` every string is falsy whatever it SPELLS, because a string is
     * not a boolean — the contents never decide. `when ("true")` staying falsy
     * is the row that makes `==` load-bearing: loose `=` would ground `"true"`
     * against `true` as strings and wrongly answer truthy.
     *
     * lessc 4.6.3 answers TRUTHY for `~"true"` because it re-parses the escaped
     * string's bytes back through evaluation. That is a Less 4 BUG (§4.4.2) and
     * v5 owes it no lowering.
     */
    await expect(lessTruthy('true')).resolves.toBe(true);
    for (const v of ['false', '0', '1', 'red', 'a', '""', '"true"', '~"true"']) {
      await expect(lessTruthy(v), `${v} must be falsy in .less`).resolves.toBe(false);
    }
  });
});

describe('§12.6c — `[ … ]` is a LIST; printing one is constrained to `<line-names>`', () => {
  /*
   * Owner ruling: usable for lists, an error on PRINTING when the bytes are not
   * valid CSS. CSS admits `[ … ]` in a value for exactly one thing — grid line
   * names, `'[' <custom-ident>* ']'` (css-grid-2 §7.1) — so idents print and
   * numbers/commas do not. `*` is ZERO or more, which is why `[]` prints.
   *
   * dart-sass 1.101.0 prints all six of these verbatim. Sass+ rejects invalid
   * CSS (ledger P4), so `.scss` takes the rule too — recorded in
   * `04-semantic-differences.mdx`.
   */
  const prints = ['[a]', '[a b]', '[]'];
  const rejects = ['[1, 2, 3]', '[1 2]', '[a, b]'];

  for (const extension of ['.jess', '.scss'] as const) {
    it(`${extension} — a <custom-ident>* interior prints as authored`, async () => {
      for (const v of prints) {
        await expect(sheet(`.a { k: ${v}; }`, extension), `${v} must print`).resolves.toBe(`.a { k: ${v}; }`);
      }
    });

    it(`${extension} — anything else is an error at the point of printing`, async () => {
      for (const v of rejects) {
        await expect(sheet(`.a { k: ${v}; }`, extension), `${v} must not print`)
          .rejects.toMatchObject({ code: 'eval/invalid-line-names' });
      }
    });

    it(`${extension} — a real grid track list renders end to end`, async () => {
      await expect(sheet('.a { grid-template-columns: [full-start] 1fr [full-end]; }', extension))
        .resolves.toBe('.a { grid-template-columns: [full-start] 1fr [full-end]; }');
    });
  }

  it('an ESCAPED custom-ident is one line name, and must still print', async () => {
    /*
     * The direction that matters: the rule must never reject what CSS accepts.
     * A CSS escape (css-syntax-3 §4.3.7) can carry a code point that would
     * otherwise end the identifier — a space, a dot, a leading digit — so
     * `[a\ b]`, `[a\.b]` and `[\31 23]` are each ONE `<custom-ident>`. A predicate
     * that whitespace-splits raw bytes gets all three wrong; this row is what
     * catches that.
     */
    for (const name of ['a\\ b', 'a\\.b', '\\31 23', '--x']) {
      await expect(sheet(`.a { grid-template-columns: [${name}] 1fr; }`, '.jess'), `[${name}] must print`)
        .resolves.toBe(`.a { grid-template-columns: [${name}] 1fr; }`);
    }
  });

  it('the rule is a DELIBERATE under-approximation, with a stated bound', async () => {
    /*
     * `<custom-ident>` excludes the CSS-wide keywords and `<line-names>` also
     * excludes `span` and `auto`, so these three are NOT valid CSS and are
     * nevertheless admitted. Under-accepting would reject valid stylesheets;
     * over-accepting only fails to catch an author error the browser catches,
     * and one identifier test is what "without too much logic machinery" buys.
     * This row exists so the bound is a decision on the record, not a gap.
     */
    for (const name of ['span', 'auto', 'inherit']) {
      await expect(sheet(`.a { k: [${name}]; }`, '.jess')).resolves.toBe(`.a { k: [${name}]; }`);
    }
  });

  it('the error is at PRINT, not at construction — the list is still a first-class value', async () => {
    /*
     * The whole content of the ruling is in this row: an unprintable bracketed
     * list may still be bound, re-bound, iterated and measured. Only emitting
     * one is constrained. A rule enforced at construction would fail every line
     * here instead of just the last.
     */
    await expect(sheet('$x: [1, 2, 3]; .a { k: b; }', '.jess')).resolves.toBe('.a { k: b; }');
    await expect(sheet('$x: [1, 2, 3]; $y: $x; .a { k: b; }', '.jess')).resolves.toBe('.a { k: b; }');
    await expect(sheet('$x: [1, 2, 3]; $for ($v of $x) { .a-${v} { k: $v; } }', '.jess'))
      .resolves.toBe('.a-1 { k: 1; } .a-2 { k: 2; } .a-3 { k: 3; }');
    await expect(sheet('$x: [1, 2, 3]; .a { k: length($x); c: nth($x, 1); }', '.scss'))
      .resolves.toBe('.a { k: 3; c: 1; }');

    await expect(sheet('$x: [1, 2, 3]; .a { k: $x; }', '.jess'))
      .rejects.toMatchObject({ code: 'eval/invalid-line-names' });
  });
});

describe('OPERATIONS §4.5.5 — `and` / `or` return an OPERAND and SHORT-CIRCUIT', () => {
  /*
   * They are native operators, not an `if(…)` rewrite: each yields one of its
   * operands rather than a `Bool`. The test applied to the operands is §4.4's
   * single predicate, so `truthy($a and $b)` is exactly `truthy($a) and
   * truthy($b)` and one semantics serves both the `$( … )` and the guard forms.
   */

  it('`.jess` — the OPERAND comes back, not a boolean', async () => {
    await expect(value('$(1 or 2)')).resolves.toBe('1');
    await expect(value('$(false or 2)')).resolves.toBe('2');
    await expect(value('$("" or 2)')).resolves.toBe('2');
    await expect(value('$(1 and 2)')).resolves.toBe('2');
    await expect(value('$(false and 2)')).resolves.toBe('false');
  });

  it('`.scss` — the same operators, the same operand result', async () => {
    await expect(sheet('.a { k: 1 or 2; }', '.scss')).resolves.toBe('.a { k: 1; }');
    await expect(sheet('$a: false; .a { k: $a or 2; }', '.scss')).resolves.toBe('.a { k: 2; }');
    await expect(sheet('.a { k: 1 and 2; }', '.scss')).resolves.toBe('.a { k: 2; }');
    await expect(sheet('.a { k: false and 2; }', '.scss')).resolves.toBe('.a { k: false; }');
  });

  /*
   * SHORT-CIRCUIT, proved OBSERVABLY rather than by reading the code. The right
   * operand is `(1px > red)`, a relational with no common ground, which §4.2a
   * makes an ASSERTION that RAISES in value position. So:
   *
   *   - if the RHS is reached, the render THROWS;
   *   - if it is skipped, the render succeeds.
   *
   * Each row is paired with a CONTROL whose left operand does NOT decide, which
   * must throw — otherwise the test would pass just as well against an engine
   * that never evaluates the RHS at all, and would prove nothing.
   */

  it('`.jess` `or` skips the right operand when the left is truthy', async () => {
    await expect(value('$(1 or (1px > red))')).resolves.toBe('1');
    await expect(value('$(false or (1px > red))')).rejects.toThrow();
  });

  it('`.jess` `and` skips the right operand when the left is falsy', async () => {
    await expect(value('$(false and (1px > red))')).resolves.toBe('false');
    await expect(value('$(1 and (1px > red))')).rejects.toThrow();
  });

  it('`.scss` `@if` short-circuits both operators', async () => {
    await expect(sheet('@if true or (1px > red) { .a { k: OK } }', '.scss')).resolves.toBe('.a { k: OK; }');
    await expect(sheet('@if false or (1px > red) { .a { k: OK } }', '.scss')).rejects.toThrow();
    await expect(sheet('@if false and (1px > red) { .a { k: OK } }', '.scss')).resolves.toBe('');
    await expect(sheet('@if true and (1px > red) { .a { k: OK } }', '.scss')).rejects.toThrow();
  });

  it('`.less` guards short-circuit too', async () => {
    /*
     * For `.less` a guard is a MATCH test (§4.2a), so a groundless comparison is
     * a non-match rather than a raise and the CONTROL cannot be a throw. It is
     * the non-match itself: reaching `(1px > red)` yields no output.
     */
    await expect(sheet('.m() when (true), (1px > red) { k: OK } .a { .m(); }', '.less')).resolves.toBe('.a { k: OK; }');
    await expect(sheet('.m() when (false) and (1px > red) { k: OK } .a { .m(); }', '.less')).resolves.toBe('');
  });

  it('`not` returns a Bool, and negates §4.4 truthiness', async () => {
    await expect(value('$(not(false))')).resolves.toBe('true');
    await expect(value('$(not(0))')).resolves.toBe('false');
    await expect(value('$(not(""))')).resolves.toBe('true');
  });
});
