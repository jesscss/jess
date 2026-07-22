import type { Color, Dimension, Keyword, Quoted, Fn } from '@jesscss/core/value';
import { textOf, defineFunction } from '@jesscss/core/value';
import { withAlpha } from './color-helper.js';

/** `fadeout(color, amount, method?)` — decrease alpha. Byte-faithful to `less/fadeout`. */
export const fadeout: Fn = defineFunction('fadeout', {
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = c as Color;
    let adjust = (amt as Dimension).number / 100;
    if (m !== undefined && textOf(m as Keyword | Quoted) === 'relative') {
      adjust = color.alpha * adjust;
    }
    return withAlpha(color, color.alpha - adjust);
  }
});
