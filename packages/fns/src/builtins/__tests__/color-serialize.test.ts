/**
 * Color serialization contract for the alpha-adjust + hsl-constructor builtins:
 *   1. an OPAQUE hex (`#rgb` / `#rrggbb`) that becomes translucent serializes as
 *      `rgba(…)`, NOT 8-digit hex (Less 4.x/v5 parity);
 *   2. a hex that ALREADY encoded an alpha channel (`#rgba` / `#rrggbbaa`) keeps
 *      its hex spelling under an alpha op;
 *   3. an ACHROMATIC / out-of-gamut `hsl()` construction clamps + canonicalizes
 *      (hue & saturation collapse to `0`, lightness stays authored).
 */
import { describe, it, expect } from 'vitest';
import { makeColorRgb, makeDimension, makeList, HEX } from '@jesscss/core/value';
import type { Color, Dimension } from '@jesscss/core/value';
import { fade as fadeFn } from '../fade.js';
import { fadeout as fadeoutFn } from '../fadeout.js';
import { hsl } from '../hsl.js';

const ctx = { modes: { unitMode: 'preserve' as const }, stringify: (value: { bytes: string }) => value.bytes };
const call = (fn: (args: ReturnType<typeof makeList>, context: typeof ctx) => unknown, ...args: Parameters<typeof makeList>[0]) =>
  colorResult(fn(makeList(args, ','), ctx));

function colorResult(value: unknown): Color {
  if (value === null || typeof value !== 'object' || !('type' in value) || value.type !== 'Color') {
    throw new TypeError('Expected a Color result.');
  }
  return value;
}

const hexColor = (rgb: [number, number, number], alpha: number, node: string): Color =>
  makeColorRgb(rgb, alpha, HEX, { node });

const pct = (n: number): Dimension => makeDimension(n, '%');

describe('color serialization: alpha op format', () => {
  it('opaque hex → translucent serializes as rgba(), not hex8', () => {
    // fadeout(#ff0, 50%)
    const yellow = hexColor([255, 255, 0], 1, '#ff0');
    const out = call(fadeoutFn, yellow, pct(50));
    expect(out.bytes).toBe('rgba(255, 255, 0, 0.5)');
  });

  it('hex WITH alpha channel keeps hex spelling under an alpha op', () => {
    // fade(#5F59, 10%)  (#5F59 = rgba(85, 255, 85, 0.6), alpha already encoded)
    const c = hexColor([85, 255, 85], 0.6, '#5F59');
    const out = call(fadeFn, c, pct(10));
    expect(out.bytes).toBe('#55ff551a');
  });

  it('8-digit hex keeps hex spelling under an alpha op', () => {
    // fade(#55FF5599, 60%)
    const c = hexColor([85, 255, 85], 0.6, '#55FF5599');
    const out = call(fadeFn, c, pct(60));
    expect(out.bytes).toBe('#55ff5599');
  });
});

describe('color serialization: hsl clamp + canonicalization', () => {
  const buildHsl = (h: number, s: number, l: number): Color =>
    call(hsl, makeDimension(h), pct(s), pct(l));

  it('out-of-range hsl clamps and canonicalizes an achromatic result', () => {
    // hsl(380, 150%, 150%) → white → hsl(0, 0%, 100%)
    expect(buildHsl(380, 150, 150).bytes).toBe('hsl(0, 0%, 100%)');
  });

  it('s === 0 collapses hue to 0 but preserves authored lightness losslessly', () => {
    // hsl(50, 0%, 33%) → hsl(0, 0%, 33%)  (NOT 32.94% from a rounded round-trip)
    expect(buildHsl(50, 0, 33).bytes).toBe('hsl(0, 0%, 33%)');
  });

  it('l === 0 canonicalizes to black', () => {
    expect(buildHsl(20, 100, 0).bytes).toBe('hsl(0, 0%, 0%)');
  });

  it('a normal in-gamut hsl stays verbatim (no canonicalization)', () => {
    expect(buildHsl(20, 50, 50).bytes).toBe('hsl(20, 50%, 50%)');
  });
});
