import type { Color } from '../value-eval.js';
import { colorBlend } from './color-helper.js';
import type { Fn } from './types.js';

/** per-channel `negation` blend (non-W3C Less extension). */
export const negationBase = (cb: number, cs: number): number => 1 - Math.abs(cb + cs - 1);

/** `negation(color1, color2)` — per-channel negation blend. Byte-faithful to `less/negation`. */
export const negation: Fn = {
  name: 'negation',
  params: [{ kinds: ['color'] }, { kinds: ['color'] }],
  body: (c1, c2) => colorBlend(negationBase, c1 as Color, c2 as Color),
};
