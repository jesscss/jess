import { hslAdjust } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `darken(color, amount, method?)` — bump HSL lightness DOWN. Byte-faithful to `less/darken`. */
export const darken: NativeFn = {
  name: 'darken',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
  body: hslAdjust(2, -1),
};
