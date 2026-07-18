import { Color, defineFunction, Dimension } from '@jesscss/core';

/**
 * Less `luminance()` — relative luminance of a color WITHOUT gamma correction
 * (`0.2126 R + 0.7152 G + 0.0722 B`), scaled by alpha. Compare `luma`, which is
 * gamma-corrected.
 * @param color the input `Color`
 * @returns the luminance as a `%` `Dimension`
 */
export default defineFunction(
  'luminance',
  function(color: Color) {
    const luminance =
      (0.2126 * color.rgb[0] / 255)
      + (0.7152 * color.rgb[1] / 255)
      + (0.0722 * color.rgb[2] / 255);

    return new Dimension({
      number: luminance * color.alpha * 100,
      unit: '%'
    });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);