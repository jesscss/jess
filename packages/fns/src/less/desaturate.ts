import { defineFunction } from '@jesscss/core';
import { hslAdjust } from './color-helper.js';
import type { Fn } from '@jesscss/core';

/** `desaturate(color, amount, method?)` — bump HSL saturation DOWN. Byte-faithful to `less/desaturate`. */
export const desaturate: Fn = defineFunction('desaturate', {
  params: [{ type: 'Color' }, { type: 'Dimension' }, { type: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(1, -1)
});
