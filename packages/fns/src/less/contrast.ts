import type { Fn } from '@jesscss/core';
import { makeColorRgb, defineFunction, RGB } from '@jesscss/core';
import { getLuma, reformatColor, requireColor } from './color-helper.js';
import { requireDimension } from './math-helper.js';

/**
 * `contrast(color, dark?, light?, threshold?)` — pick `dark` or `light` by whether
 * `color`'s luma is below `threshold` (default 0.43; a `%` threshold is a fraction
 * of 1). Defaults: dark = black, light = white; they're swapped if `dark` is
 * actually lighter. The result inherits `color`'s output format. Byte-faithful to
 * `less/contrast`.
 */
export const contrast: Fn = defineFunction('contrast', {
  params: [
    { type: 'Color' },
    { type: 'Color', optional: true },
    { type: 'Color', optional: true },
    { type: 'Dimension', optional: true }
  ],
  body: (c, dark, light, threshold) => {
    const color = requireColor(c);
    let lightC = light === undefined ? makeColorRgb([255, 255, 255], 1, RGB) : requireColor(light);
    let darkC = dark === undefined ? makeColorRgb([0, 0, 0], 1, RGB) : requireColor(dark);
    if (getLuma(darkC) > getLuma(lightC)) {
      const t = lightC;
      lightC = darkC;
      darkC = t;
    }
    let thr = 0.43;
    if (threshold !== undefined) {
      const d = requireDimension(threshold);
      thr = d.unit === '%' ? d.number / 100 : d.number;
    }
    return reformatColor(getLuma(color) < thr ? lightC : darkC, color.format);
  }
});
