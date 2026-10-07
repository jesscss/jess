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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
 * `unitMode` is a COMPILE-level option, so it is set on the Compiler and not per
 * render. These two helpers differ only in what they observe — the bytes, and the
 * warnings the render reports to its CALLER — because §4.7 makes a claim about
 * BOTH ("every rung warns except the one that throws") and a row that checked only
 * the bytes is exactly how the silent rungs stayed silent. An `undefined` mode
 * renders under the entry dialect's own default.
 */
type UnitMode = 'loose' | 'preserve' | 'strict';

const valueIn = async (expr: string, unitMode: UnitMode | undefined, extension: '.jess' | '.less' | '.scss' = '.jess') => {
  const out = await new Compiler({ compile: unitMode === undefined ? {} : { unitMode }, quiet: true })
    .renderString(`.a { k: ${expr}; }`, { filePath: `entry${extension}`, extension });
  return out.replace(/\s+/g, ' ').trim().replace(/^\.a \{ k: /, '').replace(/; \}$/, '');
};

/**
 * The warning CODES that reach a caller. `renderToResult` is the existing channel
 * for eval-time diagnostics on a source string (`safeRender` is the same channel
 * for a file); nothing new is introduced here.
 */
const warningsIn = async (expr: string, unitMode: UnitMode | undefined, extension: '.jess' | '.less' | '.scss' = '.jess') => {
  const { warnings } = await new Compiler({ compile: unitMode === undefined ? {} : { unitMode }, quiet: true })
    .renderToResult(
      { source: `.a { k: ${expr}; }`, filePath: `entry${extension}`, extension },
      { quiet: true }
    );
  return warnings.map(w => w.code);
};

/** Every `unitMode` value. */
const UNIT_MODES = ['loose', 'preserve', 'strict'] as const;

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

  it('a reciprocal unit is not expressible, so `1 / 2px` ERRORS (row h)', async () => {
    /*
     * There is no `px⁻¹` in CSS. Less 4.x answers `0.5px`, which is dimensionally
     * false; dart-sass answers `calc(0.5 / 1px)`, which does not claim the unit
     * exists but merely preserves the expression. `.jess` does neither by
     * default — it errors, unless the compile's `unitMode` says otherwise (§4.7).
     */
    await expect(value('$(1 / 2px)')).rejects.toThrow();
  });

  it('a unit product ERRORS rather than fabricating or preserving (rows f, f2, f3)', async () => {
    /*
     * `1px * 2px` is an area and CSS has no area unit; `1px * 10%` does not
     * commensurate at all. Less 4.x answers `2px` / `10px` — dimensionally false.
     * Preserving it as `calc(1px * 2px)` is no better as a default: per
     * css-values-4 §10.9 a math function's FINAL type must match its context, and
     * length² matches nothing, so that spelling is invalid CSS a browser drops.
     */
    await expect(value('$(1px * 2px)')).rejects.toThrow();
    await expect(value('$(1px * 10%)')).rejects.toThrow();
    await expect(value('$(10% * 1px)')).rejects.toThrow();
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

describe('OPERATIONS §4.7 — `.jess` units are strict by default; an explicit `unitMode` applies', () => {
  /*
   * OWNER RULING (2026-10-06): two real units that do not convert in `$( … )`
   * are an ERROR in `.jess` by default, and "it of course also depends on
   * compile settings". `.jess` stands on the same `unitMode` ladder as every
   * dialect; only its DEFAULT rung differs — `strict`, the `.jess` plugin's
   * dialect default — and an explicit compile `unitMode` replaces that default.
   *
   * `strict` keeps its Less 4.x `strictUnits` meaning: it raises on two real
   * units that do not convert (`1px + 3em`) and on a result whose unit CSS
   * cannot express — a unit PRODUCT (`1px * 2px`) or a bare RECIPROCAL
   * (`1 / 2px`). A unitless operand is not a unit: `$(1 + 2px)` is `3px` in
   * every rung (rows b, c).
   */

  /* Each `.jess` case beside the same arithmetic in `.less`, which divides only inside parens. */
  const cases: Array<[jess: string, less: string]> = [
    ['$(1 / 2px)', '(1 / 2px)'],
    ['$(1px * 2px)', '1px * 2px'],
    ['$(1px * 10%)', '1px * 10%'],
    ['$(1px + 3em)', '1px + 3em'],
    ['$(3em - 1px)', '3em - 1px']
  ];
  const expressible: Array<[string, string]> = [
    ['$(2px / 1px)', '2'],
    ['$(1px * 2)', '2px'],
    ['$(1 + 2px)', '3px'],
    ['$(3px - 1)', '2px'],
    /*
     * The cancel chain. §4.7 is a question about a FINAL value, so arithmetic must
     * keep computing THROUGH an unexpressible intermediate — `1px * 1px` has no CSS
     * unit, but `/ 1px` brings it back to an honest `1px`. Erroring on the
     * intermediate would break an expression the author got right.
     */
    ['$(1px * 1px / 1px)', '1px']
  ];

  it('by default each is the STRUCTURED unit error, as under an explicit `strict`', async () => {
    for (const [expr] of cases) {
      for (const mode of [undefined, 'strict'] as const) {
        await expect(valueIn(expr, mode), `${expr} under ${mode ?? 'the default'}`).rejects.toMatchObject({
          code: 'eval/invalid-unit-arithmetic'
        });
      }
    }
  });

  it('the error points into the `$( … )` that wrote it', async () => {
    const at = async (source: string) => {
      const { errors } = await new Compiler({ quiet: true })
        .renderToResult({ source, filePath: 'entry.jess', extension: '.jess' }, { quiet: true });
      return errors.map(error => `${error.code}@${error.line}:${error.column}`);
    };

    // Raised by the operation itself: the `+` of `1px + 3em`.
    await expect(at('.a {\n  k: $(1px + 3em);\n}')).resolves.toEqual(['eval/invalid-unit-arithmetic@2:12']);

    // Raised where the value is consumed, located where it was computed.
    await expect(at('.a {\n  k: $(1px * 2px);\n}')).resolves.toEqual(['eval/invalid-unit-arithmetic@2:12']);
    await expect(at('$x: $(1px * 2px);\n.a {\n  k: $x;\n}')).resolves.toEqual(['eval/invalid-unit-arithmetic@1:11']);

    // The failing operation of a chain, not the first one.
    await expect(at('.a {\n  k: $(1 + 1px + 3em);\n}')).resolves.toEqual(['eval/invalid-unit-arithmetic@2:16']);

    // An order over two units that do not convert: the comparison's operator.
    await expect(at('.a {\n  k: $(1em > 1px);\n}')).resolves.toEqual(['eval/invalid-unit-arithmetic@2:12']);

    // Inside a math function, the same operation inside the `$( … )`.
    await expect(at('.a {\n  k: calc(100% - $(1px + 3em));\n}')).resolves.toEqual(['eval/invalid-unit-arithmetic@2:24']);
    await expect(at('.a {\n  k: calc(100% - $(1px * 2px));\n}')).resolves.toEqual(['eval/invalid-unit-arithmetic@2:24']);
  });

  it('a `$( … )` that a math function reads is the same computation (ledger F8)', async () => {
    /*
     * `$( … )` is the opt-in to compute, wherever it stands: its math is not
     * written inside the `calc()` around it, so the `calc()` does not make it
     * any less strict, and a variable holding it answers the same wherever it
     * is read. A `calc()` used to keep such math as a silent `calc(…)` in
     * every rung, invalid CSS included (`calc(100% - calc(1px * 2px))`).
     */
    const inCalc = ['calc(100% - $(1px + 3em))', 'calc(100% - $(1px * 2px))', 'calc(100% - $(1 / 2px))'];
    for (const expr of inCalc) {
      for (const mode of [undefined, 'strict'] as const) {
        await expect(valueIn(expr, mode), `${expr} under ${mode ?? 'the default'}`).rejects.toMatchObject({
          code: 'eval/invalid-unit-arithmetic'
        });
      }
      await expect(warningsIn(expr, 'preserve'), `${expr} under preserve`).resolves.toEqual(['eval/unexpressible-unit']);
    }
    await expect(body('$x: $(1px + 3em); k: calc(100% - $x);')).rejects.toMatchObject({ code: 'eval/invalid-unit-arithmetic' });
    await expect(valueIn('calc(100% - $(1px + 3em))', 'loose')).resolves.toBe('calc(100% - 4px)');
    await expect(valueIn('calc(100% - $(1px + 3em))', 'preserve')).resolves.toContain('1px + 3em');
  });

  it('an explicit `unitMode` answers exactly what `.less` answers, warning included', async () => {
    for (const mode of ['loose', 'preserve'] as const) {
      for (const [jess, less] of cases) {
        await expect(valueIn(jess, mode), `${jess} under ${mode}`).resolves.toBe(await valueIn(less, mode, '.less'));
        await expect(warningsIn(jess, mode), `${jess} warnings under ${mode}`).resolves.toEqual(await warningsIn(less, mode, '.less'));
      }
    }
    await expect(valueIn('$(1px + 3em)', 'loose')).resolves.toBe('4px');
    await expect(valueIn('$(1px * 2px)', 'preserve')).resolves.toBe('calc(1px * 2px)');
    await expect(valueIn('$(1px + 3em)', 'preserve')).resolves.toBe('calc(1px + 3em)');
    await expect(warningsIn('$(1px + 3em)', 'preserve')).resolves.toEqual(['eval/unexpressible-unit']);
  });

  it('with no `unitMode` given, the ENTRY\'s dialect supplies the rung for every partial', async () => {
    /*
     * The `.jess` default is a compile setting (the plugin's dialect default),
     * not a node fact, so like every dialect default the entry file supplies it
     * for the whole render: `strict` under a `.jess` entry, `preserve` under a
     * `.less` one.
     */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-unit-entry-default-'));
    fs.writeFileSync(path.join(dir, 'part.jess'), '.j { k: $(1px + 3em); }');
    fs.writeFileSync(path.join(dir, 'part.less'), '.l { k: 1px + 3em; }');
    const render = async (source: string, extension: '.less' | '.jess') => {
      const result = await new Compiler({ quiet: true })
        .renderToResult({ source, filePath: path.join(dir, `entry${extension}`), extension }, { quiet: true });
      return { css: result.css.replace(/\s+/g, ' ').trim(), warnings: result.warnings.map(w => w.code), errors: result.errors.map(w => w.code) };
    };
    try {
      expect(await render('@import \'part.jess\';', '.less'))
        .toEqual({ css: '.j { k: calc(1px + 3em); }', warnings: ['eval/unexpressible-unit'], errors: [] });
      expect((await render('@-import \'./part.less\';', '.jess')).errors).toEqual(['eval/invalid-unit-arithmetic']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('`.jess` has no arithmetic spelling OUTSIDE `$( … )` — ledger P13(d), enforced by the GRAMMAR', async () => {
    await expect(valueIn('1px * 2px', 'preserve')).rejects.toMatchObject({ code: 'parse/syntax-error' });
    await expect(valueIn('1 + 2', 'preserve')).rejects.toMatchObject({ code: 'parse/syntax-error' });
  });

  it('an EXPRESSIBLE result computes and is silent in every rung, the default included', async () => {
    /*
     * The bound on the rows above: without it, erroring on EVERY operation would
     * still pass them.
     */
    for (const mode of [undefined, ...UNIT_MODES]) {
      for (const [expr, expected] of expressible) {
        await expect(valueIn(expr, mode), `${expr} under ${mode ?? 'the default'}`).resolves.toBe(expected);
        await expect(warningsIn(expr, mode), `${expr} under ${mode ?? 'the default'}`).resolves.toEqual([]);
      }
    }
  });
});

describe('OPERATIONS §4.7 — the `unitMode` ladder, in `.less`', () => {
  /*
   * The ladder itself, in the dialect whose default rung is `preserve`. `.jess`
   * answers the same way under an explicit mode (the block above).
   *
   * `.scss` is deliberately absent: whether Sass takes this ladder is under a
   * separate owner ruling, and a row here either way would entrench an answer
   * that has not been given.
   */

  it('`loose` gives Less 4.x\'s answer — the rung that folds', async () => {
    /*
     * The `/` rows are parenthesised because `.less` runs under `mathMode:
     * 'parens-division'`, where a bare `/` is a CSS value separator and never
     * divides. That is a §4.6/`mathMode` fact, not a §4.7 one — without the
     * parens these rows would assert `unitMode` behaviour against an expression
     * that never reaches arithmetic at all.
     */
    await expect(valueIn('(1 / 2px)', 'loose', '.less')).resolves.toBe('0.5px');
    await expect(valueIn('1px * 2px', 'loose', '.less')).resolves.toBe('2px');
  });

  it('`preserve` (default) says the expression back, and does NOT raise', async () => {
    await expect(valueIn('1px * 2px', 'preserve', '.less')).resolves.toBe('calc(1px * 2px)');
  });

  it('`strict` THROWS the structured unit error', async () => {
    await expect(valueIn('1px * 2px', 'strict', '.less')).rejects.toMatchObject({
      code: 'eval/invalid-unit-arithmetic'
    });
  });

  it('NO MODE IS SILENT — both non-throwing rungs warn, and it REACHES the caller', async () => {
    /*
     * The half of §4.7 that had zero assertions anywhere in the suite. Silent
     * preservation is the worst outcome: the author gets output that looks fine
     * and never learns the expression was meaningless (ledger G25 — "auto-fixed
     * AND warned — both, not either"). `strict` is excluded because it throws
     * instead, which is the one rung that says nothing extra.
     */
    for (const mode of ['loose', 'preserve'] as const) {
      await expect(warningsIn('1px * 2px', mode, '.less'), `must warn under ${mode}`)
        .resolves.toContain('eval/unexpressible-unit');
    }
  });

  it('an EXPRESSIBLE result is silent in every rung — the warning is not a blanket', async () => {
    for (const mode of UNIT_MODES) {
      await expect(valueIn('(2px / 1px)', mode, '.less')).resolves.toBe('2');
      await expect(warningsIn('(2px / 1px)', mode, '.less')).resolves.toEqual([]);
    }
  });
});

describe('OPERATIONS — a unitless number ± a dimension with a unit, per dialect', () => {
  /*
   * Owner 2026-10-06 (ledger P35): `.less` computes `4 + 3px` only under
   * `unitMode: 'loose'`, keeps it as written under `preserve`, and raises under
   * `strict`. `.scss` keeps Sass's own arithmetic — dart-sass 1.101.7 answers
   * `1 + 1px` with `2px` and no warning — in every mode; whether it should take
   * the Less ruling instead is an open owner question.
   */
  it('`.less` follows the unitMode ladder', async () => {
    await expect(valueIn('4 + 3px', 'loose', '.less')).resolves.toBe('7px');
    await expect(valueIn('4 + 3px', 'preserve', '.less')).resolves.toBe('4 + 3px');
    await expect(warningsIn('4 + 3px', 'preserve', '.less')).resolves.toEqual(['eval/unexpressible-unit']);
    await expect(valueIn('4 + 3px', 'strict', '.less')).rejects.toMatchObject({ code: 'eval/invalid-unit-arithmetic' });
  });

  it('`.scss` adds a unitless number to a dimension in every mode, as Sass does', async () => {
    for (const mode of UNIT_MODES) {
      await expect(valueIn('4 + 3px', mode, '.scss'), mode).resolves.toBe('7px');
      await expect(valueIn('3px - 1', mode, '.scss'), mode).resolves.toBe('2px');
      await expect(warningsIn('4 + 3px', mode, '.scss'), mode).resolves.toEqual([]);
    }
  });

  it('the rule is the operation\'s own dialect\'s, whatever dialect the entry is', async () => {
    /*
     * One render evaluates operations written in more than one dialect, so the
     * operation carries its dialect's answer (`Operation.unitlessAdoptsUnit`):
     * a `.scss` or `.jess` partial keeps its arithmetic under a `.less` entry,
     * and a `.less` partial keeps the ladder under a `.scss` entry.
     */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-unitless-dialect-'));
    fs.writeFileSync(path.join(dir, 'part.scss'), '.s { k: 4 + 3px; }');
    fs.writeFileSync(path.join(dir, 'part.jess'), '.j { k: $(4 + 3px); }');
    fs.writeFileSync(path.join(dir, 'part.less'), '.l { k: 4 + 3px; }');
    const render = async (source: string, extension: '.less' | '.scss', unitMode: UnitMode) => {
      const result = await new Compiler({ compile: { unitMode }, quiet: true })
        .renderToResult({ source, filePath: path.join(dir, `entry${extension}`), extension }, { quiet: true });
      return { css: result.css.replace(/\s+/g, ' ').trim(), warnings: result.warnings.map(w => w.code), errors: result.errors.map(w => w.code) };
    };
    try {
      for (const mode of UNIT_MODES) {
        const fromLess = await render('@import \'part.scss\'; @import \'part.jess\';', '.less', mode);
        expect(fromLess, mode).toEqual({ css: '.s { k: 7px; } .j { k: 7px; }', warnings: [], errors: [] });
      }
      expect(await render('@import \'part.less\';', '.scss', 'preserve'))
        .toEqual({ css: '.l { k: 4 + 3px; }', warnings: ['eval/unexpressible-unit'], errors: [] });
      expect((await render('@import \'part.less\';', '.scss', 'strict')).errors).toEqual(['eval/invalid-unit-arithmetic']);
      expect((await render('@import \'part.less\';', '.scss', 'loose')).css).toBe('.l { k: 7px; }');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('OPERATIONS §4 — loose equality `=`', () => {
  it('numeric ground: a unitless side is a wildcard (rows i, j, k, l)', async () => {
    await expect(value('$(1 = 2)')).resolves.toBe('false');
    await expect(value('$(1 = 1px)')).resolves.toBe('true');
    await expect(value('$(2 = 1px)')).resolves.toBe('false');
    await expect(value('$(2 = 2%)')).resolves.toBe('true');
  });

  it('units that do not convert are not equal, in every rung — equality never raises (row j2)', async () => {
    /*
     * §4.1 (owner 2026-08-01): equality never raises. `strict`, the `.jess`
     * default, keeps the meaning it has in Less 4.x `strictUnits` and dart-sass
     * (owner 2026-10-06), and both answer `1em == 1px` with `false`. Only an
     * ORDER over the pair has no answer, so `>` is where `strict` raises.
     */
    for (const mode of [undefined, ...UNIT_MODES]) {
      await expect(valueIn('$(1em = 1px)', mode), mode ?? 'the default').resolves.toBe('false');
      await expect(valueIn('$(1em == 1px)', mode), mode ?? 'the default').resolves.toBe('false');
    }
    await expect(valueIn('$(1em > 1px)', undefined)).rejects.toMatchObject({ code: 'eval/invalid-unit-arithmetic' });
    await expect(valueIn('$(1em > 1px)', 'preserve')).resolves.toBe('false');

    // `.scss` under `strict` answers as dart-sass does: `==` is false, `<` raises.
    const strictScss = (source: string) => new Compiler({ compile: { unitMode: 'strict' }, quiet: true })
      .renderString(source, { filePath: 'entry.scss', extension: '.scss' });
    expect((await strictScss('.a { @if 1em == 1px { k: eq; } @else { k: ne; } }')).replace(/\s+/g, ' ').trim()).toBe('.a { k: ne; }');
    await expect(strictScss('.a { @if 1em < 1px { k: lt; } }')).rejects.toMatchObject({ code: 'eval/invalid-unit-arithmetic' });
  });

  it('a guard that dispatches on the unit matches the candidate it names, as in `.less`', async () => {
    const dispatch = (param: string) => `.m(${param}) when (${param} = 1px) { k: px; } .m(${param}) when (${param} = 1em) { k: em; }`;
    await expect(sheet(`${dispatch('$a')} .x { $ > .m(1em); }`, '.jess')).resolves.toBe('.x { k: em; }');
    await expect(sheet(`${dispatch('@a')} .x { .m(1em); }`, '.less')).resolves.toBe('.x { k: em; }');
    const strictLess = await new Compiler({ compile: { unitMode: 'strict' }, quiet: true })
      .renderString(`${dispatch('@a')} .x { .m(1em); }`, { filePath: 'entry.less', extension: '.less' });
    expect(strictLess.replace(/\s+/g, ' ').trim()).toBe('.x { k: em; }');
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

describe('§12.6c — `[ … ]` is a LIST value that EMITS VERBATIM', () => {
  /*
   * Owner ruling (2026-08-31): a balanced `[ … ]` is a valid CSS simple block in
   * any declaration value (css-syntax-3), so the emitter prints it verbatim and
   * never rejects one. `[ … ]` has property-value grammar meaning in exactly one
   * place — grid `<line-names>` = `'[' <custom-ident>* ']'` (css-grid-2 §7.1) —
   * and validating THAT is property-specific, so it belongs in the lint/
   * diagnostic layer (see `lint`), not here where the property is unknown.
   *
   * This matches dart-sass 1.101.0, which prints every one of these verbatim.
   */
  const emits = ['[a]', '[a b]', '[]', '[1]', '[1 2]', '[1, 2, 3]', '[a, b]', '[span]', '[auto]', '[inherit]'];

  for (const extension of ['.jess', '.scss'] as const) {
    it(`${extension} — every bracketed value prints as authored`, async () => {
      for (const v of emits) {
        await expect(sheet(`.a { k: ${v}; }`, extension), `${v} must print`).resolves.toBe(`.a { k: ${v}; }`);
      }
    });

    it(`${extension} — a real grid track list renders end to end`, async () => {
      await expect(sheet('.a { grid-template-columns: [full-start] 1fr [full-end]; }', extension))
        .resolves.toBe('.a { grid-template-columns: [full-start] 1fr [full-end]; }');
    });
  }

  it('an ESCAPED custom-ident survives the round-trip', async () => {
    /*
     * A CSS escape (css-syntax-3 §4.3.7) can carry a code point that would
     * otherwise end the identifier — a space, a dot, a leading digit — so
     * `[a\ b]`, `[a\.b]` and `[\31 23]` are each ONE token and must emit unharmed.
     */
    for (const name of ['a\\ b', 'a\\.b', '\\31 23', '--x']) {
      await expect(sheet(`.a { grid-template-columns: [${name}] 1fr; }`, '.jess'), `[${name}] must print`)
        .resolves.toBe(`.a { grid-template-columns: [${name}] 1fr; }`);
    }
  });

  it('the list is a first-class value — bound, iterated, measured, AND printed', async () => {
    /*
     * A bracketed list may be bound, re-bound, iterated and measured, and printing
     * one is now unconstrained too: a variable holding `[1, 2, 3]` emits verbatim
     * in a declaration-value position.
     */
    await expect(sheet('$x: [1, 2, 3]; .a { k: b; }', '.jess')).resolves.toBe('.a { k: b; }');
    await expect(sheet('$x: [1, 2, 3]; $for ($v of $x) { .a-${v} { k: $v; } }', '.jess'))
      .resolves.toBe('.a-1 { k: 1; } .a-2 { k: 2; } .a-3 { k: 3; }');
    await expect(sheet('$x: [1, 2, 3]; .a { k: length($x); c: nth($x, 1); }', '.scss'))
      .resolves.toBe('.a { k: 3; c: 1; }');
    await expect(sheet('$x: [1, 2, 3]; .a { k: $x; }', '.jess'))
      .resolves.toBe('.a { k: [1, 2, 3]; }');
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
