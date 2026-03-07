import { Color, defineFunction } from '@jesscss/core';
import { colorBlend } from '../util/colorHelper.js';

export function averageBase(cb: number, cs: number) {
  return (cb + cs) / 2;
}

export default defineFunction(
  'average',
  function(color1: Color, color2: Color) {
    return colorBlend(averageBase, color1, color2);
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
