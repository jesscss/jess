import type { Fn } from '@jesscss/core/value';
import { define, checkAny } from '@jesscss/core/value';
import { makeHsl } from './kernels.js';

/** Sass `hsla()` — the same construction kernel as `hsl()` under its own dispatch name. */
export const hsla: Fn = define('hsla', {
  params: [
    { name: 'hue', type: 'any', check: checkAny },
    { name: 'saturation', type: 'any', check: checkAny, optional: true },
    { name: 'lightness', type: 'any', check: checkAny, optional: true },
    { name: 'alpha', type: 'any', check: checkAny, optional: true }
  ],
  variadic: true,
  body: (args, ctx) => makeHsl(args, ctx.modern === true)
});

export default hsla;
