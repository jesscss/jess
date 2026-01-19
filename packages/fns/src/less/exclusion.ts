import { colorBlend } from '../util/colorHelper.js';
import { Color, defineFunction } from '@jesscss/core';

export function exclusionBase(cb: number, cs: number) {
  return cb + cs - 2 * cb * cs;
}

const exclusion = defineFunction(
  'exclusion',
  function(color1: Color, color2: Color) {
    return colorBlend(exclusionBase, color1, color2);
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

export default exclusion;
