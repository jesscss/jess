import { hslAdjust } from './color-helper.js';
import type { Fn } from './types.js';

/** `darken(color, amount, method?)` — bump HSL lightness DOWN. Byte-faithful to `less/darken`. */
export const darken: Fn = {
  name: 'darken',
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(2, -1),
};
