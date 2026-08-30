import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';
import { mixColors, requireColor } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/** `mix(color1, color2, weight?)` — weighted blend (default 50%). Byte-faithful to `less/mix`. */
export const mix: Fn = defineFunction('mix', {
  params: [{ type: 'Color' }, { type: 'Color' }, { type: 'Dimension', optional: true }],
  body: (c1, c2, weight) => {
    const w = weight === undefined ? 50 : requireDimension(weight).number;
    return mixColors(requireColor(c1), requireColor(c2), w);
  }
});
