import type { Color, Fn } from '@jesscss/core/value';
import { colorRgbRounded, makeDimension, defineFunction } from '@jesscss/core/value';

/** `green(color)` — the rounded green channel (0-255). Byte-faithful to `less/green`. */
export const green: Fn = defineFunction('green', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(colorRgbRounded(c as Color)[1], '')
});
