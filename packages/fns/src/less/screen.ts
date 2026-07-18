import { colorBlend } from '../util/colorHelper.js';
import { Color, defineFunction } from '@jesscss/core';

export function screenBase(cb: number, cs: number) {
  return cb + cs - cb * cs;
}

/**
 * Less `screen()` — screen blend of two colors (the inverse of `multiply`); always
 * produces a lighter (or equal) result.
 * @param color1 backdrop `Color`
 * @param color2 source `Color`
 * @returns the blended `Color`
 */
const screen = defineFunction(
  'screen',
  function(color1: Color, color2: Color) {
    return colorBlend(screenBase, color1, color2);
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

export default screen;
