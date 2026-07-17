import type { Color } from '../value-eval.js';
import { makeDimension } from '../value-factory.js';
import { toHsv } from './color-helper.js';
import type { Fn } from './types.js';

/** `hsvsaturation(color)` — the hsv saturation as a percentage. Byte-faithful to `less/hsvsaturation`. */
export const hsvsaturation: Fn = {
  name: 'hsvsaturation',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(toHsv(c as Color)[1] * 100, '%'),
};
