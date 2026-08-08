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

  it.fails('PENDING §4.7 — a reciprocal unit is not expressible, so `1 / 2px` preserves (row h)', async () => {
    /*
     * There is no `px⁻¹` in CSS. Less 4.x answers `0.5px`, which is
     * dimensionally false, and that is what we answer today — silently, which
     * §4.7 rules out on its own ("no mode is silent"). Under the DEFAULT
     * `preserve` mode the honest outcome is the preserved expression plus a
     * warning; `loose` gives Less's answer plus a warning; `strict` throws.
     */
    await expect(value('$(1 / 2px)')).resolves.toBe('calc(1 / 2px)');
  });

  it.fails('PENDING phase 6 — a unit product preserves rather than fabricating (rows f, f2, f3)', async () => {
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

  it.fails('PENDING phase 6 — like units cancel to a unitless number (row g2)', async () => {
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

  it.fails('PENDING phase 4 — string ground: a value equals its own spelling (rows q, r, s)', async () => {
    await expect(value('$(a = b)')).resolves.toBe('false');
    await expect(value('$(a = "a")')).resolves.toBe('true');
    await expect(value('$(a = a)')).resolves.toBe('true');
  });

  it.fails('PENDING phase 4 — colour ground is rgb + alpha (rows v, w, x, y, z)', async () => {
    await expect(value('$(red = red)')).resolves.toBe('true');
    await expect(value('$(black = transparent)')).resolves.toBe('false');
    await expect(value('$(black = #000000)')).resolves.toBe('true');
    await expect(value('$(black = #00000000)')).resolves.toBe('false');
    await expect(value('$(black = #000000FF)')).resolves.toBe('true');
  });

  it.fails('PENDING phase 4 — §4.1 — the ground is picked ONCE, per pair, and nothing is transitive', async () => {
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

  it.fails('PENDING phase 4 — colour ground, and `1in = 2.54cm` (O-TRUTH-3)', async () => {
    /*
     * `black == #000000` needs the §4.1 COLOUR ground: `black` is still a
     * Keyword against a Color here, and only the ground model makes the pair
     * compare as colours at all. `1in = 2.54cm` is equal BY DEFINITION —
     * lessc 4.6.3's `false` is a conversion-precision bug, not a dialect
     * choice, and it is the one row where diverging from Less 4.x needs no
     * further justification.
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
