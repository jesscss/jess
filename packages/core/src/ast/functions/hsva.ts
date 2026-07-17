import type { Dimension } from '../value-eval.js';
import { makeColorRgb } from '../value-factory.js';
import { RGB } from '../serialize-value.js';
import { alphaToNumber, hsvToRgb, normalizeHue, percentOf } from './color-ctor-helper.js';
import type { Fn } from './types.js';

/**
 * `hsva(h, s, v, a)` — construct an RGB-format color from HSV + alpha. Byte-faithful
 * to `less/hsva`: hue via `normalizeHue`, s/v via `percentOf(1)`, alpha via
 * `alphaToNumber` (clamped 0-1). Positional (no context needed).
 */
export const hsva: Fn = {
  name: 'hsva',
  params: [{ kinds: ['dimension'] }, { kinds: ['dimension'] }, { kinds: ['dimension'] }, { kinds: ['dimension'] }],
  body: (hD, sD, vD, aD) => {
    const h = normalizeHue(hD as Dimension);
    const s = percentOf(sD as Dimension, 1);
    const v = percentOf(vD as Dimension, 1);
    const a = alphaToNumber(aD as Dimension);
    return makeColorRgb(hsvToRgb(h, s, v), a, RGB);
  },
};
