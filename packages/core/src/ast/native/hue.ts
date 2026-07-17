import type { Color } from '../value-eval.js';
import { colorHslClamped, makeDimension } from '../value-factory.js';
import type { NativeFn } from './types.js';

/** `hue(color)` — the hsl hue in degrees (0-360). Byte-faithful to `less/hue`. */
export const hue: NativeFn = {
  name: 'hue',
  params: [{ kinds: ['color'] }],
  body: (c) => makeDimension(colorHslClamped(c as Color)[0], ''),
};
