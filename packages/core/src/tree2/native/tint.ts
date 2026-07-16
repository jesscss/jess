import type { Color, Dimension } from '../value-eval.js';
import { makeColorRgb } from '../value-factory.js';
import { RGB, serializeColor } from '../serialize-value.js';
import { mixColors } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `tint(color, amount)` — mix with white, preserve the input's format. Byte-faithful to `less/tint`. */
export const tint: NativeFn = {
  name: 'tint',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }],
  body: (c, amt) => {
    const color = c as Color;
    const white = makeColorRgb([255, 255, 255], 1, RGB);
    const out = mixColors(white, color, (amt as Dimension).number);
    const alpha = Math.abs(out.alpha - 1) < 1e-12 ? 1 : out.alpha;
    const rebuilt: Color = { ...out, alpha, format: color.format, bytes: '' };
    return { ...rebuilt, bytes: serializeColor(rebuilt) };
  },
};
