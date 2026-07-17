import type { Color, Dimension } from '@jesscss/core/value';
import { makeColorRgb } from '@jesscss/core/value';
import { RGB } from '@jesscss/core/value';
import { mixColors, reformatColor, snapAlpha } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `shade(color, amount)` — mix with black, preserve the input's format. Byte-faithful to `less/shade`. */
export const shade: Fn = {
  name: 'shade',
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }],
  body: (c, amt) => {
    const color = c as Color;
    const black = makeColorRgb([0, 0, 0], 1, RGB);
    const out = mixColors(black, color, (amt as Dimension).number);
    return reformatColor({ ...out, alpha: snapAlpha(out.alpha) }, color.format);
  },
};
