import { colorBlend } from '../util/colorHelper';
import { Color, defineFunction } from '@jesscss/core';

export function screenBase(cb: number, cs: number) {
  return cb + cs - cb * cs;
}

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
