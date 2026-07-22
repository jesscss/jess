import type { Color, Fn } from '@jesscss/core/value';
import { colorHsl, makeColorHsl, defineFunction } from '@jesscss/core/value';

/** `greyscale(color)` — zero the saturation. Byte-faithful to `less/greyscale`. */
export const greyscale: Fn = defineFunction('greyscale', {
  params: [{ kinds: ['Color'] }],
  body: (c) => {
    const color = c as Color;
    const [h, , l] = colorHsl(color);
    return makeColorHsl([h, 0, l], color.alpha, color.format);
  }
});
