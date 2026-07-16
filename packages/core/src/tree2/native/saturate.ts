import type { Color, Dimension, Keyword, Quoted } from '../value-eval.js';
import { colorHsl, textOf, makeColorHsl } from '../value-factory.js';
import type { NativeFn } from './types.js';

/** `saturate(color, amount, method?)` — bump saturation UP. Byte-faithful to `less/saturate`. */
export const saturate: NativeFn = {
  name: 'saturate',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = c as Color;
    const [h, s, l] = colorHsl(color);
    let adjust = (amt as Dimension).number / 100;
    if (m !== undefined && textOf(m as Keyword | Quoted) === 'relative') adjust = s * adjust;
    return makeColorHsl([h, s + adjust, l], color.alpha, color.format);
  },
};
