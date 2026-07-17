import type { Color } from '@jesscss/core/value';
import { makeDimension } from '@jesscss/core/value';
import { toHsv } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `hsvsaturation(color)` — the hsv saturation as a percentage. Byte-faithful to `less/hsvsaturation`. */
export const hsvsaturation: Fn = {
  name: 'hsvsaturation',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(toHsv(c as Color)[1] * 100, '%'),
};
