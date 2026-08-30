import type { Fn } from '@jesscss/core';
import { makeColorRgb, defineFunction, RGB } from '@jesscss/core';
import { mixColors, reformatColor, requireColor, snapAlpha } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/**
 * `shade(color, amount = 50%)` — mix with black, preserve the input's format.
 *
 * `amount` is OPTIONAL and defaults to 50%, for the same reason as `tint`:
 * both are one-liners over `mix`, whose `weight` already defaults to 50%
 * (ledger **V9**).
 */
export const shade: Fn = defineFunction('shade', {
  params: [{ type: 'Color' }, { type: 'Dimension', optional: true }],
  body: (c, amt) => {
    const color = requireColor(c);
    const black = makeColorRgb([0, 0, 0], 1, RGB);
    const out = mixColors(black, color, amt === undefined ? 50 : requireDimension(amt).number);
    return reformatColor({ ...out, alpha: snapAlpha(out.alpha) }, color.format);
  }
});
