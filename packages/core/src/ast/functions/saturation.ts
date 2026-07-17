import type { Color } from '../value-eval.js';
import { colorHslClamped, makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `saturation(color)` — the hsl saturation as a percentage. Byte-faithful to `less/saturation`. */
export const saturation: Fn = {
  name: 'saturation',
  params: [{ kinds: ['color'] }],
  body: (c) => makeDimension(colorHslClamped(c as Color)[1] * 100, '%'),
};
