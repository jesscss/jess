import type { Fn } from '@jesscss/core';
import { makeColorRgb, defineFunction, RGB } from '@jesscss/core';
import { mixColors, reformatColor, requireColor, snapAlpha } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/**
 * `tint(color, amount = 50%)` — mix with white, preserve the input's format.
 *
 * `amount` is OPTIONAL and defaults to 50%, the same default `mix` already carries
 * for its `weight`: `tint` is a one-liner over `mix`, so it cannot require an
 * argument that its own kernel defaults (ledger **V9**).
 */
export const tint: Fn = defineFunction('tint', {
  params: [{ type: 'Color' }, { type: 'Dimension', optional: true }],
  body: (c, amt) => {
    const color = requireColor(c);
    const white = makeColorRgb([255, 255, 255], 1, RGB);
    const out = mixColors(white, color, amt === undefined ? 50 : requireDimension(amt).number);
    return reformatColor({ ...out, alpha: snapAlpha(out.alpha) }, color.format);
  }
});
