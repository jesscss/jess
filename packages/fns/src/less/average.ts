import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';
import { colorBlend, requireColor } from './color-helper.js';

/** per-channel `average` blend (non-W3C Less extension). */
export const averageBase = (cb: number, cs: number): number => (cb + cs) / 2;

/** `average(color1, color2)` — per-channel average blend. Byte-faithful to `less/average`. */
export const average: Fn = defineFunction('average', {
  params: [{ type: 'Color' }, { type: 'Color' }],
  body: (c1, c2) => colorBlend(averageBase, requireColor(c1), requireColor(c2))
});
