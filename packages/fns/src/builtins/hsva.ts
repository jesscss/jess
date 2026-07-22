import type { Dimension, Fn } from '@jesscss/core/value';
import { makeColorRgb, defineFunction, RGB } from '@jesscss/core/value';
import { alphaToNumber, hsvToRgb, normalizeHue, percentOf } from './color-ctor-helper.js';

/**
 * `hsva(h, s, v, a)` — construct an RGB-format color from HSV + alpha. Byte-faithful
 * to `less/hsva`: hue via `normalizeHue`, s/v via `percentOf(1)`, alpha via
 * `alphaToNumber` (clamped 0-1). Positional (no context needed).
 */
export const hsva: Fn = defineFunction('hsva', {
  params: [{ kinds: ['Dimension'] }, { kinds: ['Dimension'] }, { kinds: ['Dimension'] }, { kinds: ['Dimension'] }],
  body: (hD, sD, vD, aD) => {
    const h = normalizeHue(hD as Dimension);
    const s = percentOf(sD as Dimension, 1);
    const v = percentOf(vD as Dimension, 1);
    const a = alphaToNumber(aD as Dimension);
    return makeColorRgb(hsvToRgb(h, s, v), a, RGB);
  }
});
