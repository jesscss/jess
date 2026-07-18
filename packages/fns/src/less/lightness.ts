import { toHSL } from '../util/to-hsl.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

/**
 * Less `lightness()` — the HSL lightness channel of a color.
 * @param color the input `Color`
 * @returns the lightness as a `%` `Dimension`
 */
export default defineFunction(
  'lightness',
  function(color: Color) {
    return new Dimension({ number: toHSL(color).l * 100, unit: '%' });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);