import { define, checkColor } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';
import { colorBlend, requireColor } from './color-helper.js';

/** per-channel `screen` blend (W3C compositing-1). */
export const screenBase = (cb: number, cs: number): number => cb + cs - cb * cs;

/** `screen(color1, color2)` — Photoshop screen blend. Byte-faithful to `less/screen`. */
export const screen: Fn = /* @__PURE__ */ define('screen', {
  params: [{ type: 'Color', check: checkColor }, { type: 'Color', check: checkColor }],
  body: (c1, c2) => colorBlend(screenBase, requireColor(c1), requireColor(c2))
});
