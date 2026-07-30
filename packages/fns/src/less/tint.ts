import type { Fn } from '@jesscss/core';
import { makeColorRgb, defineFunction, RGB } from '@jesscss/core';
import { mixColors, reformatColor, requireColor, snapAlpha } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/** `tint(color, amount)` — mix with white, preserve the input's format. Byte-faithful to `less/tint`. */
export const tint: Fn = defineFunction('tint', {
  params: [{ type: 'Color' }, { type: 'Dimension' }],
  body: (c, amt) => {
    const color = requireColor(c);
    const white = makeColorRgb([255, 255, 255], 1, RGB);
    const out = mixColors(white, color, requireDimension(amt).number);
    return reformatColor({ ...out, alpha: snapAlpha(out.alpha) }, color.format);
  }
});
