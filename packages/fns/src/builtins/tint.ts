import type { Fn } from '@jesscss/core/value';
import { makeColorRgb, defineFunction, RGB } from '@jesscss/core/value';
import { mixColors, reformatColor, requireColor, snapAlpha } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/** `tint(color, amount)` — mix with white, preserve the input's format. Byte-faithful to `less/tint`. */
export const tint: Fn = defineFunction('tint', {
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }],
  body: (c, amt) => {
    const color = requireColor(c);
    const white = makeColorRgb([255, 255, 255], 1, RGB);
    const out = mixColors(white, color, requireDimension(amt).number);
    return reformatColor({ ...out, alpha: snapAlpha(out.alpha) }, color.format);
  }
});
