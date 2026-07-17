import { makeRgb } from './rgb.js';
import type { Fn } from './types.js';

/** `rgba` — an ALIAS of `rgb` (same construction / reformat kernel, distinct name). */
export const rgba: Fn = {
  name: 'rgba',
  params: [{ kinds: 'any' }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }],
  variadic: true,
  body: (list) => makeRgb(list),
};
