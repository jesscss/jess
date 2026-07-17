import { hslAdjust } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `saturate(color, amount, method?)` — bump HSL saturation UP. Byte-faithful to `less/saturate`. */
export const saturate: Fn = {
  name: 'saturate',
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(1, 1),
};
