import type { Color, Dimension, Keyword, Quoted } from '../value-eval.js';
import { colorHsl, textOf, makeColorHsl } from '../value-factory.js';
import type { NativeFn } from './types.js';

/** `darken(color, amount, method?)` — bump lightness DOWN. Byte-faithful to `less/darken`. */
export const darken: NativeFn = {
  name: 'darken',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = c as Color;
    const [h, s, l] = colorHsl(color);
    let adjust = (amt as Dimension).number / 100;
    if (m !== undefined && textOf(m as Keyword | Quoted) === 'relative') adjust = l * adjust;
    return makeColorHsl([h, s, l - adjust], color.alpha, color.format);
  },
};
