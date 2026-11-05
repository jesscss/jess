import { RGB_SLOT, rgbBody } from './rgb.js';
import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `rgba` — an ALIAS of `rgb` (same construction / reformat kernel, distinct name). */
export const rgba: Fn = /* @__PURE__ */ defineFunction('rgba', {
  params: [{ type: RGB_SLOT }, { type: RGB_SLOT, optional: true }, { type: RGB_SLOT, optional: true }, { type: RGB_SLOT, optional: true }],
  variadic: true,
  body: rgbBody
});
