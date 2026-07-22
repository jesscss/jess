import type { Fn } from '@jesscss/core/value';
import { textOf, defineFunction } from '@jesscss/core/value';
import { requireColor, withAlpha } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/** `fadein(color, amount, method?)` — increase alpha. Byte-faithful to `less/fadein`. */
export const fadein: Fn = defineFunction('fadein', {
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = requireColor(c);
    let adjust = requireDimension(amt).number / 100;
    if (m !== undefined && (m.type === 'Keyword' || m.type === 'Quoted') && textOf(m) === 'relative') {
      adjust = color.alpha * adjust;
    }
    return withAlpha(color, color.alpha + adjust);
  }
});
