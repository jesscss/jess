import { define, checkColor } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';
import { colorBlend, requireColor } from './color-helper.js';

/** per-channel `difference` blend (W3C compositing-1). */
export const differenceBase = (cb: number, cs: number): number => Math.abs(cb - cs);

/** `difference(color1, color2)` — Photoshop difference blend. Byte-faithful to `less/difference`. */
export const difference: Fn = /* @__PURE__ */ define('difference', {
  params: [{ type: 'Color', check: checkColor }, { type: 'Color', check: checkColor }],
  body: (c1, c2) => colorBlend(differenceBase, requireColor(c1), requireColor(c2))
});
