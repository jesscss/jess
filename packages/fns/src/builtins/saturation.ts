import type { Fn } from '@jesscss/core/value';
import { colorHslClamped, makeDimension, defineFunction } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

/** `saturation(color)` — the hsl saturation as a percentage. Byte-faithful to `less/saturation`. */
export const saturation: Fn = defineFunction('saturation', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(colorHslClamped(requireColor(c))[1] * 100, '%')
});
