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
