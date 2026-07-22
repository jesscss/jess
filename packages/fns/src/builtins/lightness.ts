import type { Fn } from '@jesscss/core/value';
import { colorHslClamped, makeDimension, defineFunction } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

/** `lightness(color)` — the hsl lightness as a percentage. Byte-faithful to `less/lightness`. */
export const lightness: Fn = defineFunction('lightness', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(colorHslClamped(requireColor(c))[2] * 100, '%')
});
