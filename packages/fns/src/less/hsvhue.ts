import type { Fn } from '@jesscss/core/value';
import { makeDimension, define, checkColor } from '@jesscss/core/value';
import { requireColor, toHsv } from './color-helper.js';

/** `hsvhue(color)` — the hsv hue in degrees. Byte-faithful to `less/hsvhue`. */
export const hsvhue: Fn = /* @__PURE__ */ define('hsvhue', {
  params: [{ type: 'Color', check: checkColor }],
  body: c => makeDimension(toHsv(requireColor(c))[0], '')
});
