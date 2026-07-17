import type { Dimension } from '../value-eval.js';
import { makeColorRgb } from '../value-factory.js';
import { HEX } from '../serialize-value.js';
import { hsvToRgb, normalizeHue, percentOf } from './color-ctor-helper.js';
import type { NativeFn } from './types.js';

/**
 * `hsv(h, s, v)` — `hsva` with alpha 1, emitted in HEX format (byte-faithful to
 * `less/hsv`, which sets `format = HEX` on the `hsva` result).
 */
export const hsv: NativeFn = {
  name: 'hsv',
  params: [{ kinds: ['dimension'] }, { kinds: ['dimension'] }, { kinds: ['dimension'] }],
  body: (hD, sD, vD) => {
    const h = normalizeHue(hD as Dimension);
    const s = percentOf(sD as Dimension, 1);
    const v = percentOf(vD as Dimension, 1);
    return makeColorRgb(hsvToRgb(h, s, v), 1, HEX);
  },
};
