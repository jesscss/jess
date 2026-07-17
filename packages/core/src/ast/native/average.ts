import type { Color } from '../value-eval.js';
import { colorBlend } from './color-helper.js';
import type { NativeFn } from './types.js';

/** per-channel `average` blend (non-W3C Less extension). */
export const averageBase = (cb: number, cs: number): number => (cb + cs) / 2;

/** `average(color1, color2)` — per-channel average blend. Byte-faithful to `less/average`. */
export const average: NativeFn = {
  name: 'average',
  params: [{ kinds: ['color'] }, { kinds: ['color'] }],
  body: (c1, c2) => colorBlend(averageBase, c1 as Color, c2 as Color),
};
