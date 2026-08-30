import type { Fn } from '@jesscss/core';
import { colorHsl, makeColorHsl, defineFunction } from '@jesscss/core';
import { requireColor } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/** `spin(color, amount)` — rotate hue by `amount` degrees (wrapped 0-360). Byte-faithful to `less/spin`. */
export const spin: Fn = defineFunction('spin', {
  params: [{ type: 'Color' }, { type: 'Dimension' }],
  body: (c, amt) => {
    const color = requireColor(c);
    const [h, s, l] = colorHsl(color);
    const hue = (h + requireDimension(amt).number) % 360;
    const adjustedHue = hue < 0 ? 360 + hue : hue;
    return makeColorHsl([adjustedHue, s, l], color.alpha, color.format);
  }
});
