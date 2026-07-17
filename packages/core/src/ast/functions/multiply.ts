import type { Color } from '../value-eval.js';
import { colorBlend } from './color-helper.js';
import type { Fn } from './types.js';

/** per-channel `multiply` blend (W3C compositing-1). */
export const multiplyBase = (cb: number, cs: number): number => cb * cs;

/** `multiply(color1, color2)` — Photoshop multiply blend. Byte-faithful to `less/multiply`. */
export const multiply: Fn = {
  name: 'multiply',
  params: [{ kinds: ['color'] }, { kinds: ['color'] }],
  body: (c1, c2) => colorBlend(multiplyBase, c1 as Color, c2 as Color),
};
