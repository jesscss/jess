import type { Color } from '../value-eval.js';
import { colorBlend } from './color-helper.js';
import { multiplyBase } from './multiply.js';
import { screenBase } from './screen.js';
import type { NativeFn } from './types.js';

/** per-channel `overlay` blend — multiply on the dark half, screen on the light half. */
export const overlayBase = (cb: number, cs: number): number => {
  cb *= 2;
  return cb <= 1 ? multiplyBase(cb, cs) : screenBase(cb - 1, cs);
};

/** `overlay(color1, color2)` — Photoshop overlay blend. Byte-faithful to `less/overlay`. */
export const overlay: NativeFn = {
  name: 'overlay',
  params: [{ kinds: ['color'] }, { kinds: ['color'] }],
  body: (c1, c2) => colorBlend(overlayBase, c1 as Color, c2 as Color),
};
