import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';
import { colorBlend, requireColor } from './color-helper.js';

/** per-channel `multiply` blend (W3C compositing-1). */
export const multiplyBase = (cb: number, cs: number): number => cb * cs;

/** `multiply(color1, color2)` — Photoshop multiply blend. Byte-faithful to `less/multiply`. */
export const multiply: Fn = defineFunction('multiply', {
  params: [{ type: 'Color' }, { type: 'Color' }],
  body: (c1, c2) => colorBlend(multiplyBase, requireColor(c1), requireColor(c2))
});
