import type { Color } from '../value-eval.js';
import { makeDimension } from '../value-factory.js';
import { getLuma } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `luma(color)` — WCAG luma × alpha as a percentage. Byte-faithful to `less/luma`. */
export const luma: NativeFn = {
  name: 'luma',
  params: [{ kinds: ['color'] }],
  body: (c) => {
    const color = c as Color;
    const a = Math.min(Math.max(color.alpha, 0), 1);
    return makeDimension(getLuma(color) * a * 100, '%');
  },
};
