import type { Color, Dimension } from '@jesscss/core/value';
import { makeColorRgb } from '@jesscss/core/value';
import { RGB } from '@jesscss/core/value';
import { mixColors, reformatColor, snapAlpha } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `tint(color, amount)` — mix with white, preserve the input's format. Byte-faithful to `less/tint`. */
export const tint: Fn = {
  name: 'tint',
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }],
  body: (c, amt) => {
    const color = c as Color;
    const white = makeColorRgb([255, 255, 255], 1, RGB);
    const out = mixColors(white, color, (amt as Dimension).number);
    return reformatColor({ ...out, alpha: snapAlpha(out.alpha) }, color.format);
  },
};
