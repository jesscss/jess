import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';
import { colorBlend, requireColor } from './color-helper.js';

/** per-channel `exclusion` blend (W3C compositing-1). */
export const exclusionBase = (cb: number, cs: number): number => cb + cs - 2 * cb * cs;

/** `exclusion(color1, color2)` — Photoshop exclusion blend. Byte-faithful to `less/exclusion`. */
export const exclusion: Fn = defineFunction('exclusion', {
  params: [{ type: 'Color' }, { type: 'Color' }],
  body: (c1, c2) => colorBlend(exclusionBase, requireColor(c1), requireColor(c2))
});
