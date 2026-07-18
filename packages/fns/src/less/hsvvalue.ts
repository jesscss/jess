import { toHSV } from '../util/to-hsv.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

/**
 * Less `hsvvalue()` — the HSV value/brightness channel of a color.
 * @param color the input `Color`
 * @returns the HSV value as a `%` `Dimension`
 */
export default defineFunction(
  'hsvvalue',
  function(color: Color) {
    return new Dimension({ number: toHSV(color).v * 100, unit: '%' });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);