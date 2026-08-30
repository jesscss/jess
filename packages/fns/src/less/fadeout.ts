import type { Fn } from '@jesscss/core';
import { textOf, defineFunction } from '@jesscss/core';
import { requireColor, withAlpha } from './color-helper.js';
import { requireDimension } from './math-helper.js';
import { mulExact, percentToFraction, subExact } from '../util/decimal.js';

/** `fadeout(color, amount, method?)` — decrease alpha. Byte-faithful to `less/fadeout`. */
export const fadeout: Fn = defineFunction('fadeout', {
  params: [{ type: 'Color' }, { type: 'Dimension' }, { type: ['Keyword', 'Quoted'], optional: true }],
  body: (c, amt, m) => {
    const color = requireColor(c);
    let adjust = percentToFraction(requireDimension(amt).number);
    if (m !== undefined && (m.type === 'Keyword' || m.type === 'Quoted') && textOf(m) === 'relative') {
      adjust = mulExact(color.alpha, adjust);
    }
    return withAlpha(color, subExact(color.alpha, adjust));
  }
});
