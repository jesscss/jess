import { defineFunction } from '@jesscss/core/value';
import type { Color, Fn } from '@jesscss/core/value';
import { colorBlend } from './color-helper.js';

/** per-channel `exclusion` blend (W3C compositing-1). */
export const exclusionBase = (cb: number, cs: number): number => cb + cs - 2 * cb * cs;

/** `exclusion(color1, color2)` — Photoshop exclusion blend. Byte-faithful to `less/exclusion`. */
export const exclusion: Fn = defineFunction('exclusion', {
  params: [{ kinds: ['Color'] }, { kinds: ['Color'] }],
  body: (c1, c2) => colorBlend(exclusionBase, c1 as Color, c2 as Color)
});
