import { HSL_PARAMS, makeHsl } from './hsl.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `hsla` — an ALIAS of `hsl` (same construction / reformat kernel, distinct name). */
export const hsla: Fn = defineFunction('hsla', {
  params: HSL_PARAMS,
  variadic: true,
  body: list => makeHsl(list)
});
