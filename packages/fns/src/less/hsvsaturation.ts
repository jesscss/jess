import type { Fn } from '@jesscss/core/value';
import { makeDimension, define, checkColor } from '@jesscss/core/value';
import { requireColor, toHsv } from './color-helper.js';

/** `hsvsaturation(color)` — the hsv saturation as a percentage. Byte-faithful to `less/hsvsaturation`. */
export const hsvsaturation: Fn = /* @__PURE__ */ define('hsvsaturation', {
  params: [{ type: 'Color', check: checkColor }],
  body: c => makeDimension(toHsv(requireColor(c))[1] * 100, '%')
});
