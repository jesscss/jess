import type { Color, Dimension } from '../value-eval.js';
import { withAlpha } from './color-helper.js';
import type { Fn } from './types.js';

/** `fade(color, amount)` — SET alpha to `amount`%. Byte-faithful to `less/fade`. */
export const fade: Fn = {
  name: 'fade',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }],
  body: (c, amt) => withAlpha(c as Color, (amt as Dimension).number / 100),
};
