import { defineFunction } from '@jesscss/core/value';
import type { Color, Dimension, Fn } from '@jesscss/core/value';
import { withAlpha } from './color-helper.js';

/** `fade(color, amount)` — SET alpha to `amount`%. Byte-faithful to `less/fade`. */
export const fade: Fn = defineFunction('fade', {
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }],
  body: (c, amt) => withAlpha(c as Color, (amt as Dimension).number / 100)
});
