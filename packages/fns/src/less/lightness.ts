import type { Fn } from '@jesscss/core/value';
import { colorLightness, define, makeDimension, checkColor } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

/** `lightness(color)` — the hsl lightness as a percentage. */
export const lightness: Fn = /* @__PURE__ */ define('lightness', {
  params: [{ type: 'Color', check: checkColor }],
  body: c => makeDimension(colorLightness(requireColor(c)) * 100, '%')
});
