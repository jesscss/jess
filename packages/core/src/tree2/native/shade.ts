import type { Color, Dimension } from '../value-eval.js';
import { makeColorRgb } from '../value-factory.js';
import { RGB, serializeColor } from '../serialize-value.js';
import { mixColors } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `shade(color, amount)` — mix with black, preserve the input's format. Byte-faithful to `less/shade`. */
export const shade: NativeFn = {
  name: 'shade',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }],
  body: (c, amt) => {
    const color = c as Color;
    const black = makeColorRgb([0, 0, 0], 1, RGB);
    const out = mixColors(black, color, (amt as Dimension).number);
    const alpha = Math.abs(out.alpha - 1) < 1e-12 ? 1 : out.alpha;
    const rebuilt: Color = { ...out, alpha, format: color.format, bytes: '' };
    return { ...rebuilt, bytes: serializeColor(rebuilt) };
  },
};
