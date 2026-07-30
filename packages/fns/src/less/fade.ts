import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';
import { requireColor, withAlpha } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/** `fade(color, amount)` — SET alpha to `amount`%. Byte-faithful to `less/fade`. */
export const fade: Fn = defineFunction('fade', {
  params: [{ type: 'Color' }, { type: 'Dimension' }],
  body: (c, amt) => withAlpha(requireColor(c), requireDimension(amt).number / 100)
});
