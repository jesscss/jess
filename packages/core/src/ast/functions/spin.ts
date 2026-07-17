import type { Color, Dimension } from '../value-eval.js';
import { colorHsl, makeColorHsl } from '../value-factory.js';
import type { Fn } from './types.js';

/** `spin(color, amount)` — rotate hue by `amount` degrees (wrapped 0-360). Byte-faithful to `less/spin`. */
export const spin: Fn = {
  name: 'spin',
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }],
  body: (c, amt) => {
    const color = c as Color;
    const [h, s, l] = colorHsl(color);
    const hue = (h + (amt as Dimension).number) % 360;
    const adjustedHue = hue < 0 ? 360 + hue : hue;
    return makeColorHsl([adjustedHue, s, l], color.alpha, color.format);
  },
};
