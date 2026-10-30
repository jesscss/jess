import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * A slash the math mode did not divide where it was written (`@d: 10px/2`) is a
 * slash list. Once math that computes reads it, it divides, and the operation
 * proceeds under the active `unitMode` — owner 2026-10-29 (DESIGN-DECISIONS
 * P35, FIXTURES): "A stored `10px/2` divides once it's used in math, so
 * `r: 10px`." Read anywhere else it stays the list.
 */
type MathMode = 'parens-division' | 'parens';
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
