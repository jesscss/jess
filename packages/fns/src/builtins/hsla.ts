import { makeHsl } from './hsl.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `hsla` — an ALIAS of `hsl` (same construction / reformat kernel, distinct name). */
export const hsla: Fn = defineFunction('hsla', {
  params: [{ kinds: 'any' }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }],
  variadic: true,
  body: list => makeHsl(list)
});
