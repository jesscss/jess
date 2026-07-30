import { defineFunction } from '@jesscss/core';
import { hslAdjust } from './color-helper.js';
import type { Fn } from '@jesscss/core';

/** `darken(color, amount, method?)` — bump HSL lightness DOWN. Byte-faithful to `less/darken`. */
export const darken: Fn = defineFunction('darken', {
  params: [{ type: 'Color' }, { type: 'Dimension' }, { type: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(2, -1)
});
