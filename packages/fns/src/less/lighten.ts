import { defineFunction } from '@jesscss/core';
import { hslAdjust } from './color-helper.js';
import type { Fn } from '@jesscss/core';

/** `lighten(color, amount, method?)` — bump HSL lightness UP. Byte-faithful to `less/lighten`. */
export const lighten: Fn = defineFunction('lighten', {
  params: [{ type: 'Color' }, { type: 'Dimension' }, { type: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(2, 1)
});
