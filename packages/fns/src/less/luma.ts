import type { Fn } from '@jesscss/core/value';
import { makeDimension, define, checkColor } from '@jesscss/core/value';
import { getLuma, requireColor } from './color-helper.js';

/** `luma(color)` — WCAG luma × alpha as a percentage. Byte-faithful to `less/luma`. */
export const luma: Fn = /* @__PURE__ */ define('luma', {
  params: [{ type: 'Color', check: checkColor }],
  body: (c) => {
    const color = requireColor(c);
    const a = Math.min(Math.max(color.alpha, 0), 1);
    return makeDimension(getLuma(color) * a * 100, '%');
  }
});
