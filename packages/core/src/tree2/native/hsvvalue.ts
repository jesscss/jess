import type { Color } from '../value-eval.js';
import { makeDimension } from '../value-factory.js';
import { toHsv } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `hsvvalue(color)` — the hsv value as a percentage. Byte-faithful to `less/hsvvalue`. */
export const hsvvalue: NativeFn = {
  name: 'hsvvalue',
  params: [{ kinds: ['color'] }],
  body: (c) => makeDimension(toHsv(c as Color)[2] * 100, '%'),
};
