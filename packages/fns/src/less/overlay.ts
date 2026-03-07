import { colorBlend } from '../util/colorHelper.js';
import { multiplyBase } from './multiply.js';
import { screenBase } from './screen.js';
import { Color, defineFunction } from '@jesscss/core';

export function overlayBase(cb: number, cs: number) {
  cb *= 2;
  return (cb <= 1)
    ? multiplyBase(cb, cs)
    : screenBase(cb - 1, cs);
}

const overlay = defineFunction(
  'overlay',
  function(color1: Color, color2: Color) {
    return colorBlend(overlayBase, color1, color2);
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

export default overlay;
