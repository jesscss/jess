import { defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';
import { colorBlend, requireColor } from './color-helper.js';

/** per-channel `negation` blend (non-W3C Less extension). */
export const negationBase = (cb: number, cs: number): number => 1 - Math.abs(cb + cs - 1);

/** `negation(color1, color2)` — per-channel negation blend. Byte-faithful to `less/negation`. */
export const negation: Fn = defineFunction('negation', {
  params: [{ kinds: ['Color'] }, { kinds: ['Color'] }],
  body: (c1, c2) => colorBlend(negationBase, requireColor(c1), requireColor(c2))
});
