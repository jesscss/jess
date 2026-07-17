import type { Color } from '@jesscss/core/value';
import { colorHslClamped, makeDimension } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `hue(color)` — the hsl hue in degrees (0-360). Byte-faithful to `less/hue`. */
export const hue: Fn = {
  name: 'hue',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(colorHslClamped(c as Color)[0], ''),
};
