import type { Fn } from '@jesscss/core';
import { makeColorRgb, defineFunction, RGB } from '@jesscss/core';
import { mixColors, reformatColor, requireColor, snapAlpha } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/** `shade(color, amount)` — mix with black, preserve the input's format. Byte-faithful to `less/shade`. */
export const shade: Fn = defineFunction('shade', {
  params: [{ type: 'Color' }, { type: 'Dimension' }],
  body: (c, amt) => {
    const color = requireColor(c);
    const black = makeColorRgb([0, 0, 0], 1, RGB);
    const out = mixColors(black, color, requireDimension(amt).number);
    return reformatColor({ ...out, alpha: snapAlpha(out.alpha) }, color.format);
  }
});
