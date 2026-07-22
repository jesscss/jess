import type { Color, Dimension, Keyword, Quoted, Fn } from '@jesscss/core/value';
import { textOf, defineFunction } from '@jesscss/core/value';
import { withAlpha } from './color-helper.js';

/** `fadein(color, amount, method?)` — increase alpha. Byte-faithful to `less/fadein`. */
export const fadein: Fn = defineFunction('fadein', {
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = c as Color;
    let adjust = (amt as Dimension).number / 100;
    if (m !== undefined && textOf(m as Keyword | Quoted) === 'relative') {
      adjust = color.alpha * adjust;
    }
    return withAlpha(color, color.alpha + adjust);
  }
});
