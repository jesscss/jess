import { colorBlend } from '../util/colorHelper.js';
import { Color, defineFunction } from '@jesscss/core';

export function multiplyBase(cb: number, cs: number) {
  return cb * cs;
}

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
