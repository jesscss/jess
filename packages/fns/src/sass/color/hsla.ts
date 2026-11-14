import type { Fn } from '@jesscss/core/value';
import { defineFunction } from '@jesscss/core/value';
import { makeHsl } from './kernels.js';

/** Sass `hsla()` — the same construction kernel as `hsl()` under its own dispatch name. */
export const hsla: Fn = defineFunction('hsla', {
  params: [
    { name: 'hue', type: 'any' },
    { name: 'saturation', type: 'any', optional: true },
    { name: 'lightness', type: 'any', optional: true },
    { name: 'alpha', type: 'any', optional: true }
  ],
  variadic: true,
  body: (args, ctx) => makeHsl(args, ctx.modern === true)
});

export default hsla;
