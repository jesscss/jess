import type { Fn } from '@jesscss/core/value';
import { colorHslClamped, define, makeDimension, checkColor } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

/** `lightness(color)` — the hsl lightness as a percentage. Byte-faithful to `less/lightness`. */
export const lightness: Fn = /* @__PURE__ */ define('lightness', {
  params: [{ type: 'Color', check: checkColor }],
  body: c => makeDimension(colorHslClamped(requireColor(c))[2] * 100, '%')
});
