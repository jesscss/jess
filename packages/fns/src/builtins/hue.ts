import type { Fn } from '@jesscss/core/value';
import { colorHslClamped, makeDimension, defineFunction } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

/** `hue(color)` — the hsl hue in degrees (0-360). Byte-faithful to `less/hue`. */
export const hue: Fn = defineFunction('hue', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(colorHslClamped(requireColor(c))[0], '')
});
