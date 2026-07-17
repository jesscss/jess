import type { Color } from '@jesscss/core/value';
import { makeDimension } from '@jesscss/core/value';
import { toHsv } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `hsvhue(color)` — the hsv hue in degrees. Byte-faithful to `less/hsvhue`. */
export const hsvhue: Fn = {
  name: 'hsvhue',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(toHsv(c as Color)[0], ''),
};
