import { describe, expect, it } from 'vitest';
import { HEX, HSL, colorHsl, makeColorHsl, makeColorRgb, makeDimension, makeList, type Color, type Keyword } from '@jesscss/core';
import { darken as darkenFn } from '../darken.js';
import { desaturate as desaturateFn } from '../desaturate.js';
import { lighten as lightenFn } from '../lighten.js';
import { saturate as saturateFn } from '../saturate.js';

const percent = (number: number) => makeDimension(number, '%');
const relative: Keyword = { type: 'Keyword', text: 'relative', bytes: 'relative' };
const ctx = { modes: { unitMode: 'preserve' as const }, stringify: (value: { bytes: string }) => value.bytes };

const call = (fn: (args: ReturnType<typeof makeList>, context: typeof ctx) => unknown, ...args: Parameters<typeof makeList>[0]): Color => {
  const value = fn(makeList(args, ','), ctx);
  if (value === null || typeof value !== 'object' || !('type' in value) || value.type !== 'Color') {
    throw new TypeError('Expected a Color result.');
  }
  return value;
};

describe('Less HSL channel adjustment', () => {
  it('clamps absolute saturation changes to the HSL channel domain', () => {
    expect(call(desaturateFn, makeColorRgb([136, 136, 136], 1, HEX), percent(10)).bytes).toBe('#888888');
    expect(call(desaturateFn, makeColorRgb([153, 153, 153], 1, HEX), percent(10)).bytes).toBe('#999999');
    const lowerBound = call(desaturateFn, makeColorHsl([120, 0.05, 0.5], 1, HSL), percent(10));
    expect(lowerBound.bytes).toBe('hsl(120, 0%, 50%)');
    expect(colorHsl(lowerBound)[1]).toBe(0);

    const upperBound = call(saturateFn, makeColorHsl([120, 0.8, 0.5], 1, HSL), percent(50));
    expect(upperBound.bytes).toBe('hsl(120, 100%, 50%)');
    expect(colorHsl(upperBound)[1]).toBe(1);
  });

  it('clamps absolute lightness changes to the HSL channel domain', () => {
    const upperBound = call(lightenFn, makeColorHsl([120, 0.5, 0.95], 1, HSL), percent(10));
    expect(upperBound.bytes).toBe('hsl(120, 50%, 100%)');
    expect(colorHsl(upperBound)[2]).toBe(1);

    const lowerBound = call(darkenFn, makeColorHsl([120, 0.5, 0.05], 1, HSL), percent(10));
    expect(lowerBound.bytes).toBe('hsl(120, 50%, 0%)');
    expect(colorHsl(lowerBound)[2]).toBe(0);
  });

  it('applies relative adjustment before clamping and preserves in-range results', () => {
    const inRange = call(desaturateFn, makeColorHsl([120, 0.5, 0.5], 1, HSL), percent(50), relative);
    expect(inRange.bytes).toBe('hsl(120, 25%, 50%)');
    expect(colorHsl(inRange)[1]).toBe(0.25);

    const bounded = call(saturateFn, makeColorHsl([120, 0.8, 0.5], 0.3, HSL), percent(50), relative);
    expect(bounded.bytes).toBe('hsla(120, 100%, 50%, 0.3)');
    expect(colorHsl(bounded)[1]).toBe(1);
    expect(bounded.alpha).toBe(0.3);
    expect(bounded.format).toBe(HSL);

    const chained = call(desaturateFn, bounded, percent(50));
    expect(colorHsl(chained)[1]).toBe(0.5);
    expect(chained.bytes).toBe('hsla(120, 50%, 50%, 0.3)');
    expect(call(desaturateFn, makeColorRgb([255, 0, 0], 1, HEX), percent(20)).bytes).toBe('#e61919');
  });
});
