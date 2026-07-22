import { defineFunction } from '@jesscss/core/value';
import type { Color, Fn } from '@jesscss/core/value';
import { colorBlend } from './color-helper.js';

/** per-channel `average` blend (non-W3C Less extension). */
export const averageBase = (cb: number, cs: number): number => (cb + cs) / 2;

/** `average(color1, color2)` — per-channel average blend. Byte-faithful to `less/average`. */
export const average: Fn = defineFunction('average', {
  params: [{ kinds: ['Color'] }, { kinds: ['Color'] }],
  body: (c1, c2) => colorBlend(averageBase, c1 as Color, c2 as Color)
});
