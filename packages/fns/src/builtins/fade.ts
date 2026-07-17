import type { Color, Dimension } from '@jesscss/core/value';
import { withAlpha } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `fade(color, amount)` — SET alpha to `amount`%. Byte-faithful to `less/fade`. */
export const fade: Fn = {
  name: 'fade',
  params: [{ kinds: ['Color'] }, { kinds: ['Dimension'] }],
  body: (c, amt) => withAlpha(c as Color, (amt as Dimension).number / 100),
};
