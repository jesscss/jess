import type { Color, Dimension, Keyword, Quoted } from '../value-eval.js';
import { textOf } from '../value-factory.js';
import { withAlpha } from './color-helper.js';
import type { Fn } from './types.js';

/** `fadeout(color, amount, method?)` — decrease alpha. Byte-faithful to `less/fadeout`. */
export const fadeout: Fn = {
  name: 'fadeout',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = c as Color;
    let adjust = (amt as Dimension).number / 100;
    if (m !== undefined && textOf(m as Keyword | Quoted) === 'relative') adjust = color.alpha * adjust;
    return withAlpha(color, color.alpha - adjust);
  },
};
