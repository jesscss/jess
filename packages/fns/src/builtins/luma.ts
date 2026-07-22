import type { Color, Fn } from '@jesscss/core/value';
import { makeDimension, defineFunction } from '@jesscss/core/value';
import { getLuma } from './color-helper.js';

/** `luma(color)` — WCAG luma × alpha as a percentage. Byte-faithful to `less/luma`. */
export const luma: Fn = defineFunction('luma', {
  params: [{ kinds: ['Color'] }],
  body: (c) => {
    const color = c as Color;
    const a = Math.min(Math.max(color.alpha, 0), 1);
    return makeDimension(getLuma(color) * a * 100, '%');
  }
});
