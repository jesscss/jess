import type { Fn, ValueGroup } from '@jesscss/core/value';
import { defineFunction, groupItems } from '@jesscss/core/value';
import { isModern, makeHsl } from './kernels.js';

/** Sass `hsla()` — the same construction kernel as `hsl()` under its own dispatch name. */
export const hsla: Fn = defineFunction('hsla', {
  params: [
    { name: 'hue', kinds: 'any' },
    { name: 'saturation', kinds: 'any', optional: true },
    { name: 'lightness', kinds: 'any', optional: true },
    { name: 'alpha', kinds: 'any', optional: true }
  ],
  variadic: true,
  body: (list: ValueGroup) => makeHsl(groupItems(list), isModern(list))
});

export default hsla;
