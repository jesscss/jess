import type { Fn, ValueGroup } from '@jesscss/core';
import { defineFunction, groupItems } from '@jesscss/core';
import { isModern, makeHsl } from './kernels.js';

/** Sass `hsla()` — the same construction kernel as `hsl()` under its own dispatch name. */
export const hsla: Fn = defineFunction('hsla', {
  params: [
    { name: 'hue', type: 'any' },
    { name: 'saturation', type: 'any', optional: true },
    { name: 'lightness', type: 'any', optional: true },
    { name: 'alpha', type: 'any', optional: true }
  ],
  variadic: true,
  body: (list: ValueGroup) => makeHsl(groupItems(list), isModern(list))
});

export default hsla;
