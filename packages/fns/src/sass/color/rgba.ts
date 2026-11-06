import type { Fn, ValueGroup } from '@jesscss/core/value';
import { defineFunction, groupItems } from '@jesscss/core/value';
import { isModern, makeRgb } from './kernels.js';

/** Sass `rgba()` — the same construction kernel as `rgb()` under its own dispatch name. */
export const rgba: Fn = defineFunction('rgba', {
  params: [
    { name: 'red', type: 'any' },
    { name: 'green', type: 'any', optional: true },
    { name: 'blue', type: 'any', optional: true },
    { name: 'alpha', type: 'any', optional: true }
  ],
  variadic: true,
  body: (list: ValueGroup) => makeRgb(groupItems(list), isModern(list))
});

export default rgba;
