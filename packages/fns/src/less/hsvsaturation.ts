import { toHSV } from '../util/to-hsv.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

/**
 * Less `hsvsaturation()` — the HSV saturation channel of a color.
 * @param color the input `Color`
 * @returns the HSV saturation as a `%` `Dimension`
 */
export default defineFunction(
  'hsvsaturation',
  function(color: Color) {
    const result = new Dimension({ number: toHSV(color).s * 100, unit: '%' });
    return result;
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);