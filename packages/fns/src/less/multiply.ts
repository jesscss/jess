import { colorBlend } from '../util/colorHelper.js';
import { Color, defineFunction } from '@jesscss/core';

export function multiplyBase(cb: number, cs: number) {
  return cb * cs;
}

/**
 * Less `multiply()` — multiply blend of two colors, channel by channel. Always
 * produces a darker (or equal) result.
 * @param color1 backdrop `Color`
 * @param color2 source `Color`
 * @returns the blended `Color`
 */
const multiply = defineFunction(
  'multiply',
  function(color1: Color, color2: Color) {
    return colorBlend(multiplyBase, color1, color2);
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

export default multiply;
