import type { Fn } from '@jesscss/core/value';
import { colorHsl, makeColorHsl, defineFunction } from '@jesscss/core/value';
import { requireColor } from './color-helper.js';

/** `greyscale(color)` — zero the saturation. Byte-faithful to `less/greyscale`. */
export const greyscale: Fn = defineFunction('greyscale', {
  params: [{ kinds: ['Color'] }],
  body: (c) => {
    const color = requireColor(c);
    const [h, , l] = colorHsl(color);
    return makeColorHsl([h, 0, l], color.alpha, color.format);
  }
});
