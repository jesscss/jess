import type { Color } from '../value-eval.js';
import { colorRgbRounded, makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `luminance(color)` — perceptual luminance × alpha as a percentage. Byte-faithful to `less/luminance`. */
export const luminance: Fn = {
  name: 'luminance',
  params: [{ kinds: ['color'] }],
  body: (c) => {
    const color = c as Color;
    const [r, g, b] = colorRgbRounded(color);
    const lum = (0.2126 * r / 255) + (0.7152 * g / 255) + (0.0722 * b / 255);
    const a = Math.min(Math.max(color.alpha, 0), 1);
    return makeDimension(lum * a * 100, '%');
  },
};
