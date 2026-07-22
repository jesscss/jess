import { colorBlend } from '../util/colorHelper.js';
import { Color, defineFunction } from '@jesscss/core';

export function negationBase(cb: number, cs: number) {
  return 1 - Math.abs(cb + cs - 1);
}

/**
 * Less `negation()` — negation blend of two colors (the inverse of `difference`):
 * `1 - |cb + cs - 1|` per channel.
 * @param color1 backdrop `Color`
 * @param color2 source `Color`
 * @returns the blended `Color`
 */
const negation = defineFunction(
  'negation',
  function(color1: Color, color2: Color) {
    return colorBlend(negationBase, color1, color2);
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

export default negation;
