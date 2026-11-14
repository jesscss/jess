import type { Fn } from '@jesscss/core/value';
import { colorHslClamped, makeDimension, define, checkColor } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

/** `saturation(color)` — the hsl saturation as a percentage. Byte-faithful to `less/saturation`. */
export const saturation: Fn = /* @__PURE__ */ define('saturation', {
  params: [{ type: 'Color', check: checkColor }],
  body: c => makeDimension(colorHslClamped(requireColor(c))[1] * 100, '%')
});
