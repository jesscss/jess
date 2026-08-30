import type { Fn } from '@jesscss/core';
import { makeDimension, defineFunction } from '@jesscss/core';
import { getLuma, requireColor } from './color-helper.js';

/** `luma(color)` — WCAG luma × alpha as a percentage. Byte-faithful to `less/luma`. */
export const luma: Fn = defineFunction('luma', {
  params: [{ type: 'Color' }],
  body: (c) => {
    const color = requireColor(c);
    const a = Math.min(Math.max(color.alpha, 0), 1);
    return makeDimension(getLuma(color) * a * 100, '%');
  }
});
