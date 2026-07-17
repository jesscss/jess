import type { Color } from '../value-eval.js';
import { colorHslClamped, makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `hue(color)` — the hsl hue in degrees (0-360). Byte-faithful to `less/hue`. */
export const hue: Fn = {
  name: 'hue',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(colorHslClamped(c as Color)[0], ''),
};
