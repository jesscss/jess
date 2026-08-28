/**
 * Alpha arithmetic is EXACT in base 10.
 *
 * Every expectation here is the TRUE DECIMAL answer, computed by hand from the
 * authored operands — never the value the implementation happens to produce.
 * Asserting the current output would pin the bug rather than the contract.
 *
 * The defect: a CSS author writes terminating decimals, IEEE-754 stores binary,
 * and `0.33333333333333` is a REPEATING binary fraction. Chained fades then
 * subtract near-equal quantities and cancel away the significant digits. Each
 * float subtraction is correctly rounded (measured: 0 ulp error per step) — the
 * loss is the BASE, not the operation, which is why the fix is base-10
 * arithmetic and not a reassociation, and emphatically not a rounding step
 * (ledger **V5** forbids quantizing a colour channel at construction; **V4**
 * puts the sole quantization at output).
 */
import { describe, it, expect } from 'vitest';
import { makeColorRgb, makeDimension, makeList, RGB } from '@jesscss/core';
import type { Color, Dimension, Keyword } from '@jesscss/core';
import { fade as fadeFn } from '../fade.js';
import { fadein as fadeinFn } from '../fadein.js';
import { fadeout as fadeoutFn } from '../fadeout.js';
import { fadeOut as sassFadeOut } from '../../sass/color/fade-out.js';
import { fadeIn as sassFadeIn } from '../../sass/color/fade-in.js';

const ctx = { modes: { unitMode: 'preserve' as const }, stringify: (value: { bytes: string }) => value.bytes };
const call = (fn: (args: ReturnType<typeof makeList>, context: typeof ctx) => unknown, ...args: Parameters<typeof makeList>[0]): Color => {
  const value = fn(makeList(args, ','), ctx);
  if (value === null || typeof value !== 'object' || !('type' in value) || value.type !== 'Color') {
    throw new TypeError('Expected a Color result.');
  }
  return value;
};

const red = (alpha: number): Color => makeColorRgb([255, 0, 0], alpha, RGB);
const pct = (n: number): Dimension => makeDimension(n, '%');
const num = (n: number): Dimension => makeDimension(n, '');

describe('alpha arithmetic is exact in base 10', () => {
  it('three chained fadeouts of 33.333333333333% land on the exact decimal 1e-14', () => {
    // 1 - 0.33333333333333 x3 = 0.00000000000001 EXACTLY, by decimal subtraction.
    let c = red(1);
    for (let i = 0; i < 3; i++) {
      c = call(fadeoutFn, c, pct(33.333333333333));
    }
    expect(c.alpha).toBe(1e-14);
  });

  it('the classic 0.1 + 0.2 case: three fadeins of 10% land on exactly 0.3', () => {
    // 0 + 0.1 + 0.1 + 0.1 = 0.3 exactly. Float gives 0.30000000000000004.
    let c = red(0);
    for (let i = 0; i < 3; i++) {
      c = call(fadeinFn, c, pct(10));
    }
    expect(c.alpha).toBe(0.3);
    expect(c.bytes).toBe('rgba(255, 0, 0, 0.3)');
  });

  it('fadeout by 0.1% seven times leaves exactly 0.993', () => {
    // 1 - 0.001 x7 = 0.993 exactly.
    let c = red(1);
    for (let i = 0; i < 7; i++) {
      c = call(fadeoutFn, c, pct(0.1));
    }
    expect(c.alpha).toBe(0.993);
  });

  it('fade() converts a percentage to a fraction exactly', () => {
    // 33.333333333333 / 100 = 0.33333333333333 exactly; float gives 0.33333333333333004.
    expect(call(fadeFn, red(1), pct(33.333333333333)).alpha).toBe(0.33333333333333);
    expect(call(fadeFn, red(1), pct(29.7)).alpha).toBe(0.297);
  });

  it('the intermediates of the fade chain are each the exact decimal', () => {
    /*
     * Proves the double round-trip through `Color.alpha` is lossless: each stored
     * alpha re-reads as the exact decimal the previous call produced.
     */
    let c = red(1);
    c = call(fadeoutFn, c, pct(33.333333333333));
    expect(c.alpha).toBe(0.66666666666667);
    c = call(fadeoutFn, c, pct(33.333333333333));
    expect(c.alpha).toBe(0.33333333333334);
  });

  it('Sass fade-out / fade-in chain exactly, on 0-1 fractions', () => {
    // 1 - 0.33333333333333 x3 = 1e-14 exactly, via the Sass spelling.
    let c = red(1);
    for (let i = 0; i < 3; i++) {
      c = call(sassFadeOut, c, num(0.33333333333333));
    }
    expect(c.alpha).toBe(1e-14);

    // 0 + 0.1 x3 = 0.3 exactly.
    let d = red(0);
    for (let i = 0; i < 3; i++) {
      d = call(sassFadeIn, d, num(0.1));
    }
    expect(d.alpha).toBe(0.3);
  });

  it('the `relative` method multiplies exactly', () => {
    // fadeout(alpha .5, 50% relative) = .5 - (.5 * .5) = 0.25 exactly.
    const relative: Keyword = { type: 'Keyword', text: 'relative', bytes: 'relative' };
    const out = call(fadeoutFn, red(0.5), pct(50), relative);
    expect(out.alpha).toBe(0.25);
  });

  it('a non-finite alpha falls back to float instead of throwing', () => {
    // big.js throws on NaN/Infinity; a numeric oddity must not become a hard error.
    expect(() => call(fadeoutFn, red(Number.NaN), pct(10))).not.toThrow();
  });
});
