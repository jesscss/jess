import { defineFunction } from '@jesscss/core/value';
import { hslAdjust } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `desaturate(color, amount, method?)` — bump HSL saturation DOWN. Byte-faithful to `less/desaturate`. */
export const desaturate: Fn = defineFunction('desaturate', {
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(1, -1)
});
