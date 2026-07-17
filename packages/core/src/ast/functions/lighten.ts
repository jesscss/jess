import { hslAdjust } from './color-helper.js';
import type { Fn } from './types.js';

/** `lighten(color, amount, method?)` — bump HSL lightness UP. Byte-faithful to `less/lighten`. */
export const lighten: Fn = {
  name: 'lighten',
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(2, 1),
};
