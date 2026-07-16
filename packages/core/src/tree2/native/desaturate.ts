import { hslAdjust } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `desaturate(color, amount, method?)` — bump HSL saturation DOWN. Byte-faithful to `less/desaturate`. */
export const desaturate: NativeFn = {
  name: 'desaturate',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
  body: hslAdjust(1, -1),
};
