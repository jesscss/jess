import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseLess } from '@jesscss/less-parser';
import { jessFunctions } from '@jesscss/plugin-less';
import { Compiler } from '../../src/index.js';

/*
 * A slash the math mode did not divide where it was written (`@d: 10px/2`) is a
 * slash list. Once math that computes reads it, it divides, and the operation
 * proceeds under the active `unitMode` — owner 2026-10-29 (DESIGN-DECISIONS
 * P35, FIXTURES): "A stored `10px/2` divides once it's used in math, so
 * `r: 10px`." Read anywhere else it stays the list.
 */
type MathMode = 'parens-division' | 'parens' | 'strict' | 'always';
type UnitMode = 'strict' | 'loose' | 'preserve';

async function render(source: string, mathMode: MathMode, unitMode: UnitMode = 'preserve', extension = '.less'): Promise<string> {
  const css = await new Compiler({ compile: { mathMode, unitMode } }).renderString(source, { extension });
  return css.replace(/\s+/g, ' ').trim();
}

const varArgs = '.m(@b) { height: (@b - 1%); depth: @b - 1%; } .x { @var: 9; .m((@var * 2) / 2); }';

describe('a stored slash divides once it is used in math', () => {
  it('divides where the operation computes, in each math mode', async () => {
    expect(await render('@d: 10px/2; .x { r: @d * 2; }', 'parens-division')).toBe('.x { r: 10px; }');
    expect(await render('@d: 10px/2; .x { r: (@d * 2); }', 'parens')).toBe('.x { r: 10px; }');
    expect(await render('@d: 10px/2/2; .x { r: (@d * 2); }', 'parens')).toBe('.x { r: 5px; }');

    /* Under `parens`, a `*` outside parens is not math, so nothing divides. */
    expect(await render('@d: 10px/2; .x { r: @d * 2; }', 'parens')).toBe('.x { r: 10px / 2 * 2; }');
  });

  it('divides a slash list a mixin argument carries (math-*/mixins-args `.var-args`)', async () => {
    expect(await render(varArgs, 'parens-division')).toBe('.x { height: 8%; depth: 8%; }');
    expect(await render(varArgs, 'parens')).toBe('.x { height: 8%; depth: 18 / 2 - 1%; }');
  });

  it('keeps a slash list no math reads', async () => {
    expect(await render('@f: 12px/1.5; @r: 2px/5px; @d: 10px/2; .x { font: @f; border-radius: @r; grid-area: 1 / 2; r: @d; }', 'parens-division'))
      .toBe('.x { font: 12px / 1.5; border-radius: 2px / 5px; grid-area: 1 / 2; r: 10px / 2; }');
  });

  it('keeps an operation inside calc() as written', async () => {
    for (const unitMode of ['strict', 'loose', 'preserve'] as const) {
      expect(await render('@v: 50vh/2; .x { w: calc(50% + (@v - 20px)); }', 'parens-division', unitMode))
        .toBe('.x { w: calc(50% + (50vh / 2 - 20px)); }');
    }
  });

  it('answers unitMode for the quotient', async () => {
    for (const unitMode of ['strict', 'loose', 'preserve'] as const) {
      expect(await render('@d: 10px/2; .x { r: @d + 1px; }', 'parens-division', unitMode)).toBe('.x { r: 6px; }');
    }
    const clash = '@d: 10px/2em; .x { r: @d + 1px; }';
    expect(await render(clash, 'parens-division', 'preserve')).toBe('.x { r: calc(10px / 2em + 1px); }');
    expect(await render(clash, 'parens-division', 'loose')).toBe('.x { r: 6px; }');

    /* Reported at the operation's operator, the `+`. */
    await expect(render(clash, 'parens-division', 'strict')).rejects.toMatchObject({ code: 'eval/invalid-unit-arithmetic', line: 1, column: 26 });
  });

  it('never lets a raw TypeError out of an operation', async () => {
    const sources = [
      '@d: 10px/2; .x { r: (@d * 2); }',
      '@d: 10px/2em; .x { r: (@d + 1px); }',
      '@d: 10px/2 3px; .x { r: (@d * 2); }',
      '@c: 1, 2; .x { r: (@c * 2); }',
      varArgs
    ];
    for (const unitMode of ['strict', 'loose', 'preserve'] as const) {
      for (const mathMode of ['parens-division', 'parens'] as const) {
        for (const source of sources) {
          const error = await render(source, mathMode, unitMode).then(() => undefined, (e: unknown) => e);
          expect(error, `${unitMode} ${mathMode} ${source}`).not.toBeInstanceOf(TypeError);
          if (error !== undefined) {
            expect(error, `${unitMode} ${mathMode} ${source}`).toMatchObject({ code: expect.stringMatching(/^eval\//) });
          }
        }
      }
    }
  });

  it('checks the division as any division that computes, in Less and its .jess lowering', async () => {
    await expect(render('@f: 12px/normal; .x { r: (@f * 2); }', 'parens-division')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
    await expect(render('$f: 12px / normal; .x { r: $(($f * 2)); }', 'parens-division', 'preserve', '.jess')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it('divides in .scss and .jess as in Less', async () => {
    expect(await render('$b: 18 / 2; .x { h: ($b - 1%); g: $b; }', 'parens-division', 'preserve', '.scss')).toBe('.x { h: 8%; g: 18 / 2; }');
    expect(await render('$d: 10px / 2; .x { r: $($d * 2); s: $d; }', 'parens-division', 'preserve', '.jess')).toBe('.x { r: 10px; s: 10px / 2; }');
  });
});

/*
 * A slash list converts to its quotient only where its use is unambiguous —
 * owner 2026-10-30 (DESIGN-DECISIONS P35): "the only time we can do division
 * is when the use is unambiguous". It is the whole argument of a parameter
 * typed as a number, or one operand of math, which a reference always is. A
 * comparison never converts, and a slash written beside other math is kept as
 * written.
 */
describe('a slash list is its quotient where its use is unambiguous', () => {
  const guarded = (call: string): string =>
    `.m(@a) when (@a > 4px) { g: yes; } .m(@a) when (default()) { g: no; } ${call}`;

  it('converts for a parameter typed as a number', async () => {
    expect(await render('@d: 10px/2; .x { a: percentage(@d); b: round(@d); c: unit(@d, em); d: min(@d, 4px); e: max(@d, 4px); }', 'parens-division'))
      .toBe('.x { a: 500%; b: 5px; c: 5em; d: 4px; e: 5px; }');
    expect(await render('@f: 12px/1.5; .x { a: percentage(@f); b: round(@f); }', 'parens-division')).toBe('.x { a: 800%; b: 8px; }');
  });

  /*
   * Owner 2026-10-30: "so `percentage(@contains-slash + 1)` is unambiguous ...
   * since it can't “add 1 to one side”". A reference is one operand.
   */
  it('converts a reference as one operand of math', async () => {
    expect(await render('@d: 1/2; @contains-slash: 16/17; .x { a: percentage(@d + 1); b: percentage(@contains-slash + 1); c: @d + 1; }', 'parens-division'))
      .toBe('.x { a: 150%; b: 194.11764706%; c: 1.5; }');
  });

  /*
   * Owner 2026-10-30: "you're right..... 1/2 + 1 is ambiguous"; "like imagine
   * font-size: 12px / 1 + 1 ... what does it mean?"; "it should be as-written
   * if they have parens-division. They stated that as their intent!!". Parens
   * state the intent, so a group still computes.
   */
  it('keeps a slash written in place beside other math as written', async () => {
    expect(await render('@w: 4 / 2 + 5em; .x { a: percentage(1/2 + 1); font-size: 12px / 1 + 1; b: round(10px/3 * 2); c: 1/2 * 3; w: @w; }', 'parens-division'))
      .toBe('.x { a: percentage(1 / 2 + 1); font-size: 12px / 1 + 1; b: round(10px / 3 * 2); c: 1 / 2 * 3; w: 4 / 2 + 5em; }');
    expect(await render('.x { a: percentage((1/2) + 1); b: percentage(1/(2 + 1)); c: 12px / (1 + 1); }', 'parens-division'))
      .toBe('.x { a: 150%; b: 33.33333333%; c: 12px / 2; }');
  });

  /*
   * Owner 2026-10-30: "the second case with when is more ambiguous so yes i
   * agree we wouldn't compare"; "so 'does match' cannot resolve, we should roll
   * that rule back".
   */
  it('never converts a slash list for a comparison, stored or written', async () => {
    expect(await render('@d: 1/2; .m() when (@d = 0.5) { g: yes; } .m() when (default()) { g: no; } .x { .m(); }', 'parens-division')).toBe('.x { g: no; }');
    expect(await render(guarded('@d: 10px/2; .x { .m(@d); } .y { .m(10px/2); }'), 'parens-division')).toBe('.x { g: no; } .y { g: no; }');
    expect(await render('@d: 10px/2; .x when (@d > 4px) { g: yes; } .y { g: no; }', 'parens-division')).toBe('.y { g: no; }');
    await expect(render('@d: 10px/2; .x { a: if(@d > 4px, y, n); }', 'parens-division')).rejects.toMatchObject({ code: 'eval/incomparable-operands' });
    await expect(render('$d: 10px / 2; .x { @if $d > 4px { i: yes; } }', 'parens-division', 'preserve', '.scss')).rejects.toMatchObject({ code: 'eval/incomparable-operands' });
  });

  it('converts a slash list a mixin argument carries for a parameter typed as a number', async () => {
    expect(await render('.m(@a) { p: percentage(@a); r: @a; } @d: 10px/2; .x { .m(@d); }', 'parens-division'))
      .toBe('.x { p: 500%; r: 10px / 2; }');
  });

  /*
   * Owner 2026-10-30, on `percentage(16/17)` staying as written: "Since
   * functions can specify types, it seems like we could use type hints to
   * auto-convert here? since obviously percentage() does not accept a slash
   * list?" A slash written in place converts where its parameter takes a
   * number, by the same conversion a stored slash takes.
   */
  it('converts a slash written in place where the parameter takes a number', async () => {
    for (const mathMode of ['parens-division', 'parens', 'strict', 'always'] as const) {
      expect(await render('.x { a: percentage(16/17); b: unit(80/16, rem); c: round(10px/3); d: min(10px/2, 4px); e: max(10px/2, 4px); }', mathMode))
        .toBe('.x { a: 94.11764706%; b: 5rem; c: 3px; d: 4px; e: 5px; }');
    }
    await expect(new Compiler({ compile: { functionMode: 'error' } }).renderString('.x { a: percentage(16/17); b: unit(80/16, rem); }', { extension: '.less' }))
      .resolves.toBe('.x {\n  a: 94.11764706%;\n  b: 5rem;\n}\n');
  });

  it('keeps a slash written in place where nothing expects a number', async () => {
    expect(await render('.x { a: length(16/17); b: extract(16/17, 1); c: calc(10px/2); d: clamp(1px, 10px/2, 9px); e: foo(10px/2); r: 10px/2; }', 'parens-division'))
      .toBe('.x { a: 2; b: 16; c: calc(10px / 2); d: clamp(1px, 10px / 2, 9px); e: foo(10px / 2); r: 10px / 2; }');
    expect(await render('.x { a: percentage(1/0); b: percentage(12px/normal); }', 'parens-division'))
      .toBe('.x { a: percentage(1 / 0); b: percentage(12px / normal); }');
  });

  /* A slash written in place in a comparison is the math mode's (V35); a group divides it. */
  it('leaves a slash written in place in a comparison to the math mode', async () => {
    expect(await render('.x { c: if(10px/2 = 5px, y, n); d: boolean(10px/2 = 5px); }', 'parens-division')).toBe('.x { c: n; d: false; }');
    expect(await render('.x { c: if((10px/2) = 5px, y, n); }', 'parens-division')).toBe('.x { c: y; }');
    expect(await render('.m() when (10px/2 = 5px) { g: yes; } .m() when (default()) { g: no; } .x { .m(); }', 'parens-division')).toBe('.x { g: no; }');
    expect(await render('.m() when ((10px/2) = 5px) { g: yes; } .m() when (default()) { g: no; } .x { .m(); }', 'parens-division')).toBe('.x { g: yes; }');
  });

  it('keeps a slash list with no quotient, as any value that is not a number', async () => {
    expect(await render('@z: 1/0; .x { a: percentage(@z); }', 'parens-division')).toBe('.x { a: percentage(1 / 0); }');
    await expect(new Compiler({ compile: { functionMode: 'error' } }).renderString('@z: 1/0; .x { a: percentage(@z); }', { extension: '.less' }))
      .rejects.toMatchObject({ code: 'eval/invalid-function' });
    expect(await render(guarded('@z: 0/0; .x { .m(@z); }'), 'parens-division')).toBe('.x { g: no; }');
    await expect(render('$z: 1 / 0; .x { @if $z > 1 { a: b; } }', 'parens-division', 'preserve', '.scss')).rejects.toMatchObject({ code: 'eval/incomparable-operands' });
    await expect(render('@z: 1/0; .x { a: if(@z > 1, y, n); }', 'parens-division')).rejects.toMatchObject({ code: 'eval/incomparable-operands' });
  });

  it('keeps the list where it is written out or a parameter accepts any value', async () => {
    expect(await render('@d: 10px/2; @f: 12px/1.5; .x { r: @d; font: @f; a: length(@d); b: extract(@d, 1); }', 'parens-division'))
      .toBe('.x { r: 10px / 2; font: 12px / 1.5; a: 2; b: 10px; }');
  });

  it('keeps a slash list that does not divide to a number, as any value that is not a number', async () => {
    expect(await render('@f: 12px/normal; .x { a: percentage(@f); b: if(@f = 12px/normal, y, n); }', 'parens-division'))
      .toBe('.x { a: percentage(12px / normal); b: y; }');
    await expect(render('@f: 12px/normal; .x { a: if(@f > 1px, y, n); }', 'parens-division')).rejects.toMatchObject({ code: 'eval/incomparable-operands' });
    expect(await render(guarded('@f: 12px/normal; .x { .m(@f); }'), 'parens-division')).toBe('.x { g: no; }');
  });

  it('answers unitMode as the same division written in a group does', async () => {
    const pairs = [
      ['@d: 10px/2em; .x { a: percentage(@d); b: round(@d); c: unit(@d, em); }', '.x { a: percentage((10px/2em)); b: round((10px/2em)); c: unit((10px/2em), em); }'],
      ['.x { a: percentage(10px/2em); b: round(10px/2em); c: unit(10px/2em, em); }', '.x { a: percentage((10px/2em)); b: round((10px/2em)); c: unit((10px/2em), em); }']
    ] as const;
    for (const unitMode of ['strict', 'loose', 'preserve'] as const) {
      for (const [stored, written] of pairs) {
        const answer = (source: string): Promise<unknown> => render(source, 'parens-division', unitMode).catch((e: { code?: string }) => e.code);
        expect(await answer(stored), `${unitMode} ${stored}`).toBe(await answer(written));
      }
    }
  });

  it('converts in .scss and .jess as in Less', async () => {
    expect(await render('@use "sass:math"; $d: 10px / 2; $h: 1 / 2; .x { a: percentage($h); b: round($d); c: math.unit($d); d: min($d, 4px); e: math.max($d, 4px); f: math.div($d, 2); r: $d; }', 'parens-division', 'preserve', '.scss'))
      .toBe('.x { a: 50%; b: 5px; c: "px"; d: 4px; e: 5px; f: 2.5px; r: 10px / 2; }');
    expect(await render('@-from "#less" import (percentage, round); $d: 10px / 2; .x { a: $percentage($d); b: $round($d); r: $d; }', 'parens-division', 'preserve', '.jess'))
      .toBe('.x { a: 500%; b: 5px; r: 10px / 2; }');
  });

  it('converts a slash written in place in .scss and .jess as in Less', async () => {
    expect(await render('@use "sass:math"; .x { a: percentage(16 / 17); b: round(10px / 3); c: min(10px / 2, 4px); d: math.unit(80 / 16); e: math.max(10px / 2, 4px); f: length(16 / 17); g: calc(10px / 2); r: 10px / 2; }', 'parens-division', 'preserve', '.scss'))
      .toBe('.x { a: 94.11764706%; b: 3px; c: 4px; d: ""; e: 5px; f: 2; g: calc(10px / 2); r: 10px / 2; }');
    expect(await render('@-from "#less" import (percentage, unit, round, length); .x { a: $percentage(16 / 17); b: $unit(80 / 16, rem); c: $round(10px / 3); d: $length(16 / 17); e: min(10px / 2, 4px); f: calc(10px / 2); r: 10px / 2; }', 'parens-division', 'preserve', '.jess'))
      .toBe('.x { a: 94.11764706%; b: 5rem; c: 3px; d: 2; e: min(10px / 2, 4px); f: calc(10px / 2); r: 10px / 2; }');
  });

  it('gives the same CSS through .jess', async () => {
    const LESS_FUNCTIONS = jessFunctions();
    const sources = [
      '@d: 10px/2; @f: 12px/1.5; .x { a: percentage(@d); b: round(@d); c: unit(@d, em); d: min(@d, 4px); r: @d; font: @f; }',
      guarded('@d: 10px/2; .x { .m(@d); }'),
      '@d: 10px/2; .m(@a) when (@a >= 5px) and (@a <= 5px) and (@a = 5px) { g: yes; } .m(@a) when (default()) { g: no; } .x { .m(@d); }',
      '@d: 1/2; .m() when (@d = 0.5) { g: yes; } .m() when (default()) { g: no; } .x { .m(); }',
      '@d: 1/2; @contains-slash: 16/17; .x { a: percentage(@d + 1); b: percentage(@contains-slash + 1); }',
      '.x { a: percentage(16/17); b: unit(80/16, rem); c: round(10px/3); d: min(10px/2, 4px); e: length(16/17); f: calc(10px/2); r: 10px/2; }'
    ];
    for (const less of sources) {
      const jess = emitJess(parseLess(less), { functions: LESS_FUNCTIONS });
      expect(await render(jess, 'parens-division', 'preserve', '.jess'), jess).toBe(await render(less, 'parens-division'));
    }
  });
});
