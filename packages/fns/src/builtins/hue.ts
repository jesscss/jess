import type { Color, Fn } from '@jesscss/core/value';
import { colorHslClamped, makeDimension, defineFunction } from '@jesscss/core/value';

/** `hue(color)` — the hsl hue in degrees (0-360). Byte-faithful to `less/hue`. */
export const hue: Fn = defineFunction('hue', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(colorHslClamped(c as Color)[0], '')
});
