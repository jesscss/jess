import type { Color } from '../value-eval.js';
import { makeDimension } from '../value-factory.js';
import { toHsv } from './color-helper.js';
import type { Fn } from './types.js';

/** `hsvhue(color)` — the hsv hue in degrees. Byte-faithful to `less/hsvhue`. */
export const hsvhue: Fn = {
  name: 'hsvhue',
  params: [{ kinds: ['color'] }],
  body: (c) => makeDimension(toHsv(c as Color)[0], ''),
};
