import type { Fn } from '@jesscss/core';
import { makeDimension, defineFunction } from '@jesscss/core';
import { requireColor, toHsv } from './color-helper.js';

/** `hsvsaturation(color)` — the hsv saturation as a percentage. Byte-faithful to `less/hsvsaturation`. */
export const hsvsaturation: Fn = defineFunction('hsvsaturation', {
  params: [{ type: 'Color' }],
  body: c => makeDimension(toHsv(requireColor(c))[1] * 100, '%')
});
