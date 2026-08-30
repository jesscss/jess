import { makeRgb } from './rgb.js';
import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';

/** `rgba` — an ALIAS of `rgb` (same construction / reformat kernel, distinct name). */
export const rgba: Fn = defineFunction('rgba', {
  params: [{ type: 'any' }, { type: 'any', optional: true }, { type: 'any', optional: true }, { type: 'any', optional: true }],
  variadic: true,
  body: list => makeRgb(list)
});
