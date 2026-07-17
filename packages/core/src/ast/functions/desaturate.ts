import { hslAdjust } from './color-helper.js';
import type { Fn } from './types.js';

/** `desaturate(color, amount, method?)` — bump HSL saturation DOWN. Byte-faithful to `less/desaturate`. */
export const desaturate: Fn = {
  name: 'desaturate',
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(1, -1),
};
