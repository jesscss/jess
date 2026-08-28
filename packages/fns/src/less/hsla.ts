import { makeHsl } from './hsl.js';
import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';

/** `hsla` — an ALIAS of `hsl` (same construction / reformat kernel, distinct name). */
export const hsla: Fn = defineFunction('hsla', {
  params: [{ type: 'any' }, { type: 'any', optional: true }, { type: 'any', optional: true }, { type: 'any', optional: true }],
  variadic: true,
  body: list => makeHsl(list)
});
