import type { Color } from '@jesscss/core/value';
import { colorHslClamped, makeDimension } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `saturation(color)` — the hsl saturation as a percentage. Byte-faithful to `less/saturation`. */
export const saturation: Fn = {
  name: 'saturation',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(colorHslClamped(c as Color)[1] * 100, '%'),
};
