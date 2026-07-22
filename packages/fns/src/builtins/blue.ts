import type { Color, Fn } from '@jesscss/core/value';
import { colorRgbRounded, makeDimension, defineFunction } from '@jesscss/core/value';

/** `blue(color)` — the rounded blue channel (0-255). Byte-faithful to `less/blue`. */
export const blue: Fn = defineFunction('blue', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(colorRgbRounded(c as Color)[2], '')
});
