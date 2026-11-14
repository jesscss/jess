import { define, checkColor } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';
import { colorBlend, requireColor } from './color-helper.js';
import { overlayBase } from './overlay.js';

/** per-channel `hard-light` blend — `overlay` with the operands swapped. */
export const hardlightBase = (cb: number, cs: number): number => overlayBase(cs, cb);

/** `hardlight(color1, color2)` — Photoshop hard-light blend. Byte-faithful to `less/hardlight`. */
export const hardlight: Fn = /* @__PURE__ */ define('hardlight', {
  params: [{ type: 'Color', check: checkColor }, { type: 'Color', check: checkColor }],
  body: (c1, c2) => colorBlend(hardlightBase, requireColor(c1), requireColor(c2))
});
