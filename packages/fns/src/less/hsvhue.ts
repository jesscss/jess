import type { Fn } from '@jesscss/core';
import { makeDimension, defineFunction } from '@jesscss/core';
import { requireColor, toHsv } from './color-helper.js';

/** `hsvhue(color)` — the hsv hue in degrees. Byte-faithful to `less/hsvhue`. */
export const hsvhue: Fn = defineFunction('hsvhue', {
  params: [{ type: 'Color' }],
  body: c => makeDimension(toHsv(requireColor(c))[0], '')
});
