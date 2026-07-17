import type { Color } from '../value-eval.js';
import { colorBlend } from './color-helper.js';
import { overlayBase } from './overlay.js';
import type { NativeFn } from './types.js';

/** per-channel `hard-light` blend — `overlay` with the operands swapped. */
export const hardlightBase = (cb: number, cs: number): number => overlayBase(cs, cb);

/** `hardlight(color1, color2)` — Photoshop hard-light blend. Byte-faithful to `less/hardlight`. */
export const hardlight: NativeFn = {
  name: 'hardlight',
  params: [{ kinds: ['color'] }, { kinds: ['color'] }],
  body: (c1, c2) => colorBlend(hardlightBase, c1 as Color, c2 as Color),
};
