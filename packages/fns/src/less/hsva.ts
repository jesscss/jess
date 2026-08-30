import type { Fn } from '@jesscss/core';
import { makeColorRgb, defineFunction, RGB } from '@jesscss/core';
import { alphaToNumber, hsvToRgb, normalizeHue, percentOf } from './color-ctor-helper.js';
import { requireDimension } from './math-helper.js';

/**
 * `hsva(h, s, v, a)` — construct an RGB-format color from HSV + alpha. Byte-faithful
 * to `less/hsva`: hue via `normalizeHue`, s/v via `percentOf(1)`, alpha via
 * `alphaToNumber` (clamped 0-1). Positional (no context needed).
 */
export const hsva: Fn = defineFunction('hsva', {
  params: [{ type: 'Dimension' }, { type: 'Dimension' }, { type: 'Dimension' }, { type: 'Dimension' }],
  body: (hD, sD, vD, aD) => {
    const h = normalizeHue(requireDimension(hD));
    const s = percentOf(requireDimension(sD), 1);
    const v = percentOf(requireDimension(vD), 1);
    const a = alphaToNumber(requireDimension(aD));
    return makeColorRgb(hsvToRgb(h, s, v), a, RGB);
  }
});
