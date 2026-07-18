import { toHSL } from '../util/to-hsl.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

/**
 * Less `saturation()` — the HSL saturation channel of a color.
 * @param color the input `Color`
 * @returns the saturation as a `%` `Dimension`
 */
export default defineFunction(
  'saturation',
  function(color: Color) {
    const result = new Dimension({ number: toHSL(color).s * 100, unit: '%' });
    return result;
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);