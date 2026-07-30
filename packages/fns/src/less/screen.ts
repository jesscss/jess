import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';
import { colorBlend, requireColor } from './color-helper.js';

/** per-channel `screen` blend (W3C compositing-1). */
export const screenBase = (cb: number, cs: number): number => cb + cs - cb * cs;

/** `screen(color1, color2)` — Photoshop screen blend. Byte-faithful to `less/screen`. */
export const screen: Fn = defineFunction('screen', {
  params: [{ type: 'Color' }, { type: 'Color' }],
  body: (c1, c2) => colorBlend(screenBase, requireColor(c1), requireColor(c2))
});
