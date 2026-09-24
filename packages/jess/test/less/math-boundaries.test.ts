import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * Where Less math does and does not reach, now that every slash is the division
 * rule's and computed math lowers into an `Expression` (DESIGN-DECISIONS
 * P34/P35).
 */
async function render(source: string, compile: { mathMode?: 'always' | 'parens-division'; unitMode?: 'strict' | 'loose' | 'preserve' } = {}): Promise<string> {
  const css = await new Compiler({ compile }).renderString(source, { language: 'less', extension: '.less' });
  return css.replace(/\s+/g, ' ').trim();
}

describe('Less math boundaries', () => {
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
