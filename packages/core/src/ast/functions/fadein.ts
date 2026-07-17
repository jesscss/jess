import type { Color, Dimension, Keyword, Quoted } from '../value-eval.js';
import { textOf } from '../value-factory.js';
import { withAlpha } from './color-helper.js';
import type { Fn } from './types.js';

/** `fadein(color, amount, method?)` — increase alpha. Byte-faithful to `less/fadein`. */
export const fadein: Fn = {
  name: 'fadein',
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = c as Color;
    let adjust = (amt as Dimension).number / 100;
    if (m !== undefined && textOf(m as Keyword | Quoted) === 'relative') adjust = color.alpha * adjust;
    return withAlpha(color, color.alpha + adjust);
  },
};
