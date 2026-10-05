import { describe, expect, it } from 'vitest';
import { HEX, HSL, RGB, serializeColor } from '../color.js';
import type { Color } from '../value-eval.js';
import { makeColorHsl, makeColorRgb } from '../value-factory.js';

/**
 * Ruling V4 (numeric emit) + V5 (colour quantized at the OUTPUT boundary only) over
 * the colour serializer. Every emitted colour number goes through `formatNumber` —
 * the ONE output policy — not a fixed decimal-places `round`.
 *
 * The five `round(x, 8)` calls these pin (authored `%` alpha, `%` rgb channels, hue,
 * S, L) were the last 8-dp holdouts in the value domain. An 8-dp floor is a DECIMAL-
 * PLACES rule, so it annihilates any magnitude below ~5e-9 to literally `0` — the
 * failure mode V4 names explicitly and the reason it is a relative tolerance instead.
 */
describe('colour emit obeys the output number policy', () => {
  const rgbPct = (pct: number): Color => makeColorRgb([0, 0, 0], 1, RGB, { rgbPct: [pct, 0, 0] });
  const alphaPct = (pct: number): Color => makeColorRgb([1, 2, 3], 0.5, RGB, { alphaPct: pct });
  const hsl = (h: number, s: number, l: number): Color => makeColorHsl([h, s, l], 1, HSL);

  it('never annihilates a small magnitude to zero (the 8-dp floor did)', () => {
    expect(serializeColor(rgbPct(2e-9))).toBe('rgb(0.000000002%, 0%, 0%)');
    expect(serializeColor(alphaPct(3e-9))).toBe('rgba(1, 2, 3, 0.000000003%)');
    expect(serializeColor(hsl(1e-9, 1, 0.5))).toBe('hsl(0.000000001, 100%, 50%)');
    expect(serializeColor(hsl(90, 1e-11, 0.5))).toBe('hsl(90, 0.000000001%, 50%)');
    expect(serializeColor(hsl(90, 1, 1e-10))).toBe('hsl(90, 100%, 0.00000001%)');
  });

  it('emits positional decimals, never scientific notation (CSSOM §6.7.2)', () => {
    for (const css of [
      serializeColor(rgbPct(2e-9)),
      serializeColor(alphaPct(3e-9)),
      serializeColor(hsl(1e-9, 1e-11, 1e-10))
    ]) {
      expect(css).not.toMatch(/e[+-]/i);
    }
  });

  it('still trims genuine float noise', () => {
    expect(serializeColor(hsl(90, 1, 0.509999999999999))).toBe('hsl(90, 100%, 51%)');
    expect(serializeColor(rgbPct(0.1 + 0.2))).toBe('rgb(0.3%, 0%, 0%)');
  });

  it('is magnitude-invariant, unlike a decimal-places rule', () => {
    // 8 dp keeps 11 significant digits at magnitude 100; a 1e-10 RELATIVE
    // tolerance keeps the same ~10 everywhere.
    expect(serializeColor(hsl(100 / 3, 1, 0.5))).toBe('hsl(33.333333333, 100%, 50%)');
    expect(serializeColor(rgbPct(100 / 3))).toBe('rgb(33.333333333%, 0%, 0%)');
  });
});

/*
 * `hsl` is the source of truth for an HSL-op result, but `rgb` is read directly by
 * every consumer that projects a colour (the legacy `@plugin` bridges hand it to
 * plugin code as `color.rgb`), so it must hold the real channels, never a stub.
 */
describe('an HSL-sourced colour carries its real rgb channels', () => {
  it('derives rgb from hsl at construction', () => {
    const c = makeColorHsl([45, 1, 0.5], 1, HEX);
    expect(c.rgb).toEqual([255, 191.25, 0]);
    expect(c.bytes).toBe('#ffbf00');
  });
});
