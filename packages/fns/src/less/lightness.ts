import type { Fn } from '@jesscss/core';
import { colorHslClamped, makeDimension, defineFunction } from '@jesscss/core';
import { requireColor } from './color-helper.js';

/** `lightness(color)` — the hsl lightness as a percentage. Byte-faithful to `less/lightness`. */
export const lightness: Fn = defineFunction('lightness', {
  params: [{ type: 'Color' }],
  body: c => makeDimension(colorHslClamped(requireColor(c))[2] * 100, '%')
});
