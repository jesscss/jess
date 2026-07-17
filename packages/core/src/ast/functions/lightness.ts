import type { Color } from '../value-eval.js';
import { colorHslClamped, makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `lightness(color)` — the hsl lightness as a percentage. Byte-faithful to `less/lightness`. */
export const lightness: Fn = {
  name: 'lightness',
  params: [{ kinds: ['color'] }],
  body: (c) => makeDimension(colorHslClamped(c as Color)[2] * 100, '%'),
};
