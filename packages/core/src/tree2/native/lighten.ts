import type { Color, Dimension, Keyword, Quoted } from '../value-eval.js';
import { colorHsl, textOf, makeColorHsl } from '../value-factory.js';
import type { NativeFn } from './types.js';

/**
 * `lighten(color, amount, method?)` — read hsl (lazy source of truth), bump
 * lightness, preserve the original format. Byte-faithful to legacy `less/lighten`.
 * (Relocated verbatim from the foundation's `fns-native.ts` proof set — color is a
 * LATER batch; this is the already-converted proof, homed under the shared template.)
 */
export const lighten: NativeFn = {
  name: 'lighten',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = c as Color;
    const [h, s, l] = colorHsl(color);
    let adjust = (amt as Dimension).number / 100;
    if (m !== undefined && textOf(m as Keyword | Quoted) === 'relative') adjust = l * adjust;
    return makeColorHsl([h, s, l + adjust], color.alpha, color.format);
  },
};
