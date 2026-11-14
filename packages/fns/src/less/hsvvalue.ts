import type { Fn } from '@jesscss/core/value';
import { makeDimension, define, checkColor } from '@jesscss/core/value';
import { requireColor, toHsv } from './color-helper.js';

/** `hsvvalue(color)` — the hsv value as a percentage. Byte-faithful to `less/hsvvalue`. */
export const hsvvalue: Fn = /* @__PURE__ */ define('hsvvalue', {
  params: [{ type: 'Color', check: checkColor }],
  body: c => makeDimension(toHsv(requireColor(c))[2] * 100, '%')
});
