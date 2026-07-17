import type { Color } from '@jesscss/core/value';
import { colorBlend } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** per-channel `negation` blend (non-W3C Less extension). */
export const negationBase = (cb: number, cs: number): number => 1 - Math.abs(cb + cs - 1);

/** `negation(color1, color2)` — per-channel negation blend. Byte-faithful to `less/negation`. */
export const negation: Fn = {
  name: 'negation',
  params: [{ kinds: ['Color'] }, { kinds: ['Color'] }],
  body: (c1, c2) => colorBlend(negationBase, c1 as Color, c2 as Color),
};
