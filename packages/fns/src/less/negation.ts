import { colorBlend } from '../util/colorHelper.js';
import { Color, defineFunction } from '@jesscss/core';

export function negationBase(cb: number, cs: number) {
  return 1 - Math.abs(cb + cs - 1);
}

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
