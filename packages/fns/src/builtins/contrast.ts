import type { Color, Dimension } from '@jesscss/core/value';
import { makeColorRgb } from '@jesscss/core/value';
import { RGB } from '@jesscss/core/value';
import { getLuma, reformatColor } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/**
 * `contrast(color, dark?, light?, threshold?)` — pick `dark` or `light` by whether
 * `color`'s luma is below `threshold` (default 0.43; a `%` threshold is a fraction
 * of 1). Defaults: dark = black, light = white; they're swapped if `dark` is
 * actually lighter. The result inherits `color`'s output format. Byte-faithful to
 * `less/contrast`.
 */
export const contrast: Fn = {
  name: 'contrast',
  params: [
    { kinds: ['Color'] },
    { kinds: ['Color'], optional: true },
    { kinds: ['Color'], optional: true },
    { kinds: ['Dimension'], optional: true },
  ],
  body: (c, dark, light, threshold) => {
    const color = c as Color;
    let lightC = (light as Color | undefined) ?? makeColorRgb([255, 255, 255], 1, RGB);
    let darkC = (dark as Color | undefined) ?? makeColorRgb([0, 0, 0], 1, RGB);
    if (getLuma(darkC) > getLuma(lightC)) {
      const t = lightC;
      lightC = darkC;
      darkC = t;
    }
    let thr = 0.43;
    if (threshold !== undefined) {
      const d = threshold as Dimension;
      thr = d.unit === '%' ? d.number / 100 : d.number;
    }
    return reformatColor(getLuma(color) < thr ? lightC : darkC, color.format);
  },
};
