import type { Fn } from '@jesscss/core/value';
import { colorRgbRounded, makeDimension, defineFunction } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

/** `red(color)` — the rounded red channel (0-255). Byte-faithful to `less/red`. */
export const red: Fn = defineFunction('red', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(colorRgbRounded(requireColor(c))[0], '')
});
