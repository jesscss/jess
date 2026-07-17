import type { Color, Dimension } from '@jesscss/core/value';
import { mixColors } from './color-helper.js';
import type { Fn } from '@jesscss/core/value';

/** `mix(color1, color2, weight?)` — weighted blend (default 50%). Byte-faithful to `less/mix`. */
export const mix: Fn = {
  name: 'mix',
  params: [{ kinds: ['Color'] }, { kinds: ['Color'] }, { kinds: ['Dimension'], optional: true }],
  body: (c1, c2, weight) => {
    const w = weight === undefined ? 50 : (weight as Dimension).number;
    return mixColors(c1 as Color, c2 as Color, w);
  },
};
