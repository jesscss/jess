import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * Where Less math does and does not reach, now that every slash is the division
 * rule's and computed math lowers into an `Expression` (DESIGN-DECISIONS
 * P34/P35).
 */
async function render(source: string, compile: { mathMode?: 'always' | 'parens-division' | 'parens'; unitMode?: 'strict' | 'loose' | 'preserve' } = {}): Promise<string> {
  const css = await new Compiler({ compile }).renderString(source, { language: 'less', extension: '.less' });
  return css.replace(/\s+/g, ' ').trim();
}

async function renderJess(source: string): Promise<string> {
  const css = await new Compiler().renderString(source, { language: 'jess', extension: '.jess' });
  return css.replace(/\s+/g, ' ').trim();
}

describe('Less math boundaries', () => {
  /*
   * Math inside a math function is kept as written, in every dialect — owner
   * 2026-09-24 (DESIGN-DECISIONS P35): its result is clamped to what the
   * property allows (css-values-4 §10.12), so folding changes the value.
   */
  it('keeps calc() math as written, substituting variables', async () => {
    expect(await render('@a: 10px; .x { w: calc(@a * 2); p: calc(1px - 5px); }'))
      .toBe('.x { w: calc(10px * 2); p: calc(1px - 5px); }');
    expect(await render('@v: 50vh/2; .x { w: calc(50% + (@v - 20px)); }', { unitMode: 'strict' }))
      .toBe('.x { w: calc(50% + (50vh / 2 - 20px)); }');
  });

  /*
   * Nothing computes inside a math function, so nothing consumes a paren written
   * there: every authored group is kept, redundant or not — owner 2026-10-06,
   * "no reason to drop parens. the user wanted to write it that way for a reason."
   */
  it('keeps every paren authored inside calc(), in .less and .jess', async () => {
    expect(await render('@v: 10px; .x { w: calc(100% - ((@v * 3) + (@v * 2))); h: calc(100% + (25vh - 20px)); }'))
      .toBe('.x { w: calc(100% - ((10px * 3) + (10px * 2))); h: calc(100% + (25vh - 20px)); }');
    expect(await render('@v: 10px; .x { a: calc((@v)); b: calc( (1px + 2px) ); c: calc(100% - (((@v + @v)))); }'))
      .toBe('.x { a: calc((10px)); b: calc((1px + 2px)); c: calc(100% - (((10px + 10px)))); }');
    expect(await renderJess('$v: 10px; .x { w: calc(100% - (($v * 3) + ($v * 2))); }'))
      .toBe('.x { w: calc(100% - ((10px * 3) + (10px * 2))); }');
    expect(await renderJess('.x { w: calc(10px / (2 * 5)); v: calc(((10vh)) + calc((5vh))); }'))
      .toBe('.x { w: calc(10px / (2 * 5)); v: calc(((10vh)) + calc((5vh))); }');
  });

  it('still consumes the parens of Less math outside a math function', async () => {
    expect(await render('@v: 1; .x { a: (1px + 2px) 3px; b: -(@v); c: (10vh); }'))
      .toBe('.x { a: 3px 3px; b: -1; c: 10vh; }');
    expect(await render('.x { w: 4px * (1 + 1) / 4 + 3px; v: 2 * (1px + 1em); }', { mathMode: 'parens' }))
      .toBe('.x { w: 4px * 2 / 4 + 3px; v: 2 * calc(1px + 1em); }');
  });

  /*
   * Division by zero is an evaluation error in every unit mode (owner
   * 2026-09-24, DESIGN-DECISIONS P35): the author opted into division and there
   * is no quotient to print. This is the case the `units/loose` and
   * `units/no-strict` fixtures used to carry as `ignores 0/0 rules`.
   */
  it('raises on division by zero under math: always, in every unit mode', async () => {
    for (const unitMode of ['strict', 'loose', 'preserve'] as const) {
      await expect(render('.x { font: ignores 0/0 rules; }', { mathMode: 'always', unitMode }), unitMode)
        .rejects.toMatchObject({ code: 'eval/division-by-zero' });
      await expect(render('.x { w: (1px / 0); }', { unitMode }), unitMode)
        .rejects.toMatchObject({ code: 'eval/division-by-zero' });
    }
    expect(await render('.x { font: ignores 0/0 rules; }')).toBe('.x { font: ignores 0 / 0 rules; }');
  });

  it('keeps calc() around a value that is not one number', async () => {
    expect(await render('@v: 50vh/2; .x { w: calc(@v); }')).toBe('.x { w: calc(50vh / 2); }');
  });

  it('keeps the parens of an authored group that a preserved call does not evaluate', async () => {
    expect(await render('.x { w: hsl(210, percentage((20 / 20)), 50%); }'))
      .toBe('.x { w: hsl(210, percentage((20 / 20)), 50%); }');
  });

  it('validates the units of every slash-list side, as it does a lone operation', async () => {
    await expect(render('.x { w: 2px*3px/1px; }', { unitMode: 'strict' })).rejects.toThrow('Invalid unit arithmetic');
    await expect(render('.x { w: 2px*3px; }', { unitMode: 'strict' })).rejects.toThrow('Invalid unit arithmetic');
  });

  it('gives an @import media postlude the same query value as @media', async () => {
    expect(await render('@import url(a.css) (min-width: 2*3px);')).toBe('@import url(a.css) (min-width: 6px);');
    expect(await render('@media (min-width: 2*3px) { .y { k: 1; } }')).toBe('@media (min-width: 6px) { .y { k: 1; } }');
  });

  it('leaves a <declaration-value> payload literal: style() and var() fallbacks', async () => {
    expect(await render('@a: 3; @container style(--x: @a * 2) { .y { k: 1; } }'))
      .toBe('@container style(--x: 3 * 2) { .y { k: 1; } }');
    expect(await render('@a: 3; .x { w: var(--y, @a * 2); v: var(--y, 4 / 2 + 5em); }'))
      .toBe('.x { w: var(--y, 3 * 2); v: var(--y, 4 / 2 + 5em); }');
    expect(await render('.x { w: var(--y, 1/2); }', { mathMode: 'always' })).toBe('.x { w: var(--y, 1/2); }');
  });
});
