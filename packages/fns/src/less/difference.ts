import { colorBlend } from '../util/colorHelper';
import { Color, defineFunction } from '@jesscss/core';

export function differenceBase(cb: number, cs: number) {
  return Math.abs(cb - cs);
}

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
