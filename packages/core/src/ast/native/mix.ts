import type { Color, Dimension } from '../value-eval.js';
import { mixColors } from './color-helper.js';
import type { NativeFn } from './types.js';

/** `mix(color1, color2, weight?)` — weighted blend (default 50%). Byte-faithful to `less/mix`. */
export const mix: NativeFn = {
  name: 'mix',
  params: [{ kinds: ['color'] }, { kinds: ['color'] }, { kinds: ['dimension'], optional: true }],
  body: (c1, c2, weight) => {
    const w = weight === undefined ? 50 : (weight as Dimension).number;
    return mixColors(c1 as Color, c2 as Color, w);
  },
};
