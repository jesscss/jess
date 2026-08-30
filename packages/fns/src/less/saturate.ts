import { defineFunction } from '@jesscss/core';
import { hslAdjust } from './color-helper.js';
import type { Fn } from '@jesscss/core';

/** `saturate(color, amount, method?)` — bump HSL saturation UP. Byte-faithful to `less/saturate`. */
export const saturate: Fn = defineFunction('saturate', {
  params: [{ type: 'Color' }, { type: 'Dimension' }, { type: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(1, 1)
});
