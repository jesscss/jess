import type { Fn } from '@jesscss/core/value';
import { define, checkAny } from '@jesscss/core/value';
import { rgbBody } from './rgb.js';

/** Sass `rgba()` — the same construction kernel as `rgb()` under its own dispatch name. */
export const rgba: Fn = define('rgba', {
  params: [
    { name: 'red', type: 'any', check: checkAny },
    { name: 'green', type: 'any', check: checkAny, optional: true },
    { name: 'blue', type: 'any', check: checkAny, optional: true },
    { name: 'alpha', type: 'any', check: checkAny, optional: true }
  ],
  variadic: true,
  body: rgbBody
});

export default rgba;
