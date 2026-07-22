import type { Color, Fn } from '@jesscss/core/value';
import { colorRgbRounded, makeDimension, defineFunction } from '@jesscss/core/value';

/** `luminance(color)` — perceptual luminance × alpha as a percentage. Byte-faithful to `less/luminance`. */
export const luminance: Fn = defineFunction('luminance', {
  params: [{ kinds: ['Color'] }],
  body: (c) => {
    const color = c as Color;
    const [r, g, b] = colorRgbRounded(color);
    const lum = (0.2126 * r / 255) + (0.7152 * g / 255) + (0.0722 * b / 255);
    const a = Math.min(Math.max(color.alpha, 0), 1);
    return makeDimension(lum * a * 100, '%');
  }
});
