import type { Color } from '../value-eval.js';
import { makeDimension } from '../value-factory.js';
import { toHsv } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `hsvsaturation(color)` — the hsv saturation as a percentage. Byte-faithful to `less/hsvsaturation`. */
export const hsvsaturation: NativeFn = {
  name: 'hsvsaturation',
  params: [{ kinds: ['color'] }],
  body: (c) => makeDimension(toHsv(c as Color)[1] * 100, '%'),
};
