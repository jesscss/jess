import type { Color } from '../value-eval.js';
import { colorBlend } from './color-helper.js';
import type { Fn } from './types.js';

/** per-channel `screen` blend (W3C compositing-1). */
export const screenBase = (cb: number, cs: number): number => cb + cs - cb * cs;

/** `screen(color1, color2)` — Photoshop screen blend. Byte-faithful to `less/screen`. */
export const screen: Fn = {
  name: 'screen',
  params: [{ kinds: ['color'] }, { kinds: ['color'] }],
  body: (c1, c2) => colorBlend(screenBase, c1 as Color, c2 as Color),
};
