import type { Fn } from '@jesscss/core';
import { colorHslClamped, makeDimension, defineFunction } from '@jesscss/core';
import { requireColor } from './color-helper.js';

/** `hue(color)` — the hsl hue in degrees (0-360). Byte-faithful to `less/hue`. */
export const hue: Fn = defineFunction('hue', {
  params: [{ type: 'Color' }],
  body: c => makeDimension(colorHslClamped(requireColor(c))[0], '')
});
