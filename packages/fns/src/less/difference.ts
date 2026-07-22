import { colorBlend } from '../util/colorHelper.js';
import { Color, defineFunction } from '@jesscss/core';

export function differenceBase(cb: number, cs: number) {
  return Math.abs(cb - cs);
}

/**
 * Less `difference()` — subtract the two colors channel by channel and take the
 * absolute value.
 * @param color1 backdrop `Color`
 * @param color2 source `Color`
 * @returns the blended `Color`
 */
const difference = defineFunction(
  'difference',
  function(color1: Color, color2: Color) {
    return colorBlend(differenceBase, color1, color2);
  },
  {
    params: [{
      name: 'color1',
      type: Color
    }, {
      name: 'color2',
      type: Color
    }]
  }
);

export default difference;
