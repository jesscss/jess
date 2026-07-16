import type { Color, Dimension } from '../value-eval.js';
import { makeColorRgb } from '../value-factory.js';
import { RGB } from '../serialize-value.js';
import { mixColors, reformatColor, snapAlpha } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `tint(color, amount)` — mix with white, preserve the input's format. Byte-faithful to `less/tint`. */
export const tint: NativeFn = {
  name: 'tint',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }],
  body: (c, amt) => {
    const color = c as Color;
    const white = makeColorRgb([255, 255, 255], 1, RGB);
    const out = mixColors(white, color, (amt as Dimension).number);
    return reformatColor({ ...out, alpha: snapAlpha(out.alpha) }, color.format);
  },
};
