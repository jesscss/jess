import type { Color } from '../value-eval.js';
import { colorHsl, makeColorHsl } from '../value-factory.js';
import type { Fn } from './types.js';

/** `greyscale(color)` — zero the saturation. Byte-faithful to `less/greyscale`. */
export const greyscale: Fn = {
  name: 'greyscale',
  params: [{ kinds: ['Color'] }],
  body: (c) => {
    const color = c as Color;
    const [h, , l] = colorHsl(color);
    return makeColorHsl([h, 0, l], color.alpha, color.format);
  },
};
