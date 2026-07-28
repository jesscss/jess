import { defineFunction } from '@jesscss/core/value';
import { hslAdjust } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `darken(color, amount, method?)` — bump HSL lightness DOWN. Byte-faithful to `less/darken`. */
export const darken: Fn = defineFunction('darken', {
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: hslAdjust(2, -1)
});
