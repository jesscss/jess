import type { Fn } from '@jesscss/core/value';
import { makeDimension, defineFunction } from '@jesscss/core/value';
import { requireColor, toHsv } from './color-helper.js';

/** `hsvvalue(color)` — the hsv value as a percentage. Byte-faithful to `less/hsvvalue`. */
export const hsvvalue: Fn = defineFunction('hsvvalue', {
  params: [{ kinds: ['Color'] }],
  body: c => makeDimension(toHsv(requireColor(c))[2] * 100, '%')
});
