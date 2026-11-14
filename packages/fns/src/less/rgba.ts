import { RGB_PARAMS, rgbBody } from './rgb.js';
import { define } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `rgba` — an ALIAS of `rgb` (same construction / reformat kernel, distinct name). */
export const rgba: Fn = /* @__PURE__ */ define('rgba', {
  params: RGB_PARAMS,
  variadic: true,
  body: rgbBody
});
