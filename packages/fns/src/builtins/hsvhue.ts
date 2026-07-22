import type { Color, Fn } from '@jesscss/core/value';
import { makeDimension, defineFunction } from '@jesscss/core/value';
import { toHsv } from './color-helper.js';

/** `hsvhue(color)` — the hsv hue in degrees. Byte-faithful to `less/hsvhue`. */
export const hsvhue: Fn = defineFunction('hsvhue', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(toHsv(c as Color)[0], '')
});
