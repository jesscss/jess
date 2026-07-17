import type { Color } from '@jesscss/core/value';
import { makeDimension } from '@jesscss/core/value';
import { toHsv } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `hsvvalue(color)` — the hsv value as a percentage. Byte-faithful to `less/hsvvalue`. */
export const hsvvalue: Fn = {
  name: 'hsvvalue',
  params: [{ kinds: ['Color'] }],
  body: (c) => makeDimension(toHsv(c as Color)[2] * 100, '%'),
};
