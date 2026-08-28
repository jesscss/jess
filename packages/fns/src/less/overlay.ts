import { defineFunction } from '@jesscss/core';
import type { Fn } from '@jesscss/core';
import { colorBlend, requireColor } from './color-helper.js';
import { multiplyBase } from './multiply.js';
import { screenBase } from './screen.js';

/** per-channel `overlay` blend — multiply on the dark half, screen on the light half. */
export const overlayBase = (cb: number, cs: number): number => {
  cb *= 2;
  return cb <= 1 ? multiplyBase(cb, cs) : screenBase(cb - 1, cs);
};

/** `overlay(color1, color2)` — Photoshop overlay blend. Byte-faithful to `less/overlay`. */
export const overlay: Fn = defineFunction('overlay', {
  params: [{ type: 'Color' }, { type: 'Color' }],
  body: (c1, c2) => colorBlend(overlayBase, requireColor(c1), requireColor(c2))
});
