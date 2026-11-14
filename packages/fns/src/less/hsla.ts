import { HSL_PARAMS, makeHsl } from './hsl.js';
import { define } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `hsla` — an ALIAS of `hsl` (same construction / reformat kernel, distinct name). */
export const hsla: Fn = /* @__PURE__ */ define('hsla', {
  params: HSL_PARAMS,
  variadic: true,
  body: (args, ctx) => makeHsl(args, ctx.modern === true)
});
