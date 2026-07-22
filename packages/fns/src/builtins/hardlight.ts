import { defineFunction } from '@jesscss/core/value';
import type { Color, Fn } from '@jesscss/core/value';
import { colorBlend } from './color-helper.js';
import { overlayBase } from './overlay.js';

/** per-channel `hard-light` blend — `overlay` with the operands swapped. */
export const hardlightBase = (cb: number, cs: number): number => overlayBase(cs, cb);

/** `hardlight(color1, color2)` — Photoshop hard-light blend. Byte-faithful to `less/hardlight`. */
export const hardlight: Fn = defineFunction('hardlight', {
  params: [{ kinds: ['Color'] }, { kinds: ['Color'] }],
  body: (c1, c2) => colorBlend(hardlightBase, c1 as Color, c2 as Color)
});
