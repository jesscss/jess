import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';
import { requireDimension } from '../shared/math/math-helper.js';
import { rotateHue } from '../shared/color/kernels.js';

/** `spin(color, amount)` — rotate hue by `amount` degrees (wrapped 0-360). Byte-faithful to `less/spin`. */
export const spin: Fn = defineFunction('spin', {
  params: [{ type: 'Color' }, { type: 'Dimension' }],
  body: (c, amt) => rotateHue(requireColor(c), requireDimension(amt).number)
});
