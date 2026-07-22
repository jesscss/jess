import type { Color, Fn } from '@jesscss/core/value';
import { colorHslClamped, makeDimension, defineFunction } from '@jesscss/core/value';

/** `lightness(color)` — the hsl lightness as a percentage. Byte-faithful to `less/lightness`. */
export const lightness: Fn = defineFunction('lightness', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(colorHslClamped(c as Color)[2] * 100, '%')
});
