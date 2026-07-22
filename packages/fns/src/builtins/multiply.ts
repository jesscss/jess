import { defineFunction } from '@jesscss/core/value';
import type { Color, Fn } from '@jesscss/core/value';
import { colorBlend } from './color-helper.js';

/** per-channel `multiply` blend (W3C compositing-1). */
export const multiplyBase = (cb: number, cs: number): number => cb * cs;

/** `multiply(color1, color2)` — Photoshop multiply blend. Byte-faithful to `less/multiply`. */
export const multiply: Fn = defineFunction('multiply', {
  params: [{ kinds: ['Color'] }, { kinds: ['Color'] }],
  body: (c1, c2) => colorBlend(multiplyBase, c1 as Color, c2 as Color)
});
