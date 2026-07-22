import { Color, defineFunction, Dimension } from '@jesscss/core';
import { getLuma } from '../util/get-luma.js';

/**
 * Less `luma()` — the perceptual, gamma-corrected relative luminance of a color,
 * weighted by its alpha. Compare `luminance()`, which is not gamma-corrected.
 * @param color the input `Color`
 * @returns the luma as a `%` `Dimension`
 */
export default defineFunction(
  'luma',
  function(color: Color) {
    return new Dimension({
      number: getLuma(color) * color.alpha * 100,
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