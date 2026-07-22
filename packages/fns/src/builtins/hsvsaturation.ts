import type { Color, Fn } from '@jesscss/core/value';
import { makeDimension, defineFunction } from '@jesscss/core/value';
import { toHsv } from './color-helper.js';

/** `hsvsaturation(color)` — the hsv saturation as a percentage. Byte-faithful to `less/hsvsaturation`. */
export const hsvsaturation: Fn = defineFunction('hsvsaturation', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(toHsv(c as Color)[1] * 100, '%')
});
