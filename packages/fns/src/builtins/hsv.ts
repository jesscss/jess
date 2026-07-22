import type { Dimension, Fn } from '@jesscss/core/value';
import { makeColorRgb, defineFunction, HEX } from '@jesscss/core/value';
import { hsvToRgb, normalizeHue, percentOf } from './color-ctor-helper.js';

/**
 * `hsv(h, s, v)` — `hsva` with alpha 1, emitted in HEX format (byte-faithful to
 * `less/hsv`, which sets `format = HEX` on the `hsva` result).
 */
export const hsv: Fn = defineFunction('hsv', {
  params: [{ kinds: ['Dimension'] }, { kinds: ['Dimension'] }, { kinds: ['Dimension'] }],
  body: (hD, sD, vD) => {
    const h = normalizeHue(hD as Dimension);
    const s = percentOf(sD as Dimension, 1);
    const v = percentOf(vD as Dimension, 1);
    return makeColorRgb(hsvToRgb(h, s, v), 1, HEX);
  }
});
