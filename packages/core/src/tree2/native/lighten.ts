import { hslAdjust } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `lighten(color, amount, method?)` — bump HSL lightness UP. Byte-faithful to `less/lighten`. */
export const lighten: NativeFn = {
  name: 'lighten',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
  body: hslAdjust(2, 1),
};
