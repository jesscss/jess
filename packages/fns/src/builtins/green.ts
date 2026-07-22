import type { Fn } from '@jesscss/core/value';
import { colorRgbRounded, makeDimension, defineFunction } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

/** `green(color)` — the rounded green channel (0-255). Byte-faithful to `less/green`. */
export const green: Fn = defineFunction('green', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(colorRgbRounded(requireColor(c))[1], '')
});
