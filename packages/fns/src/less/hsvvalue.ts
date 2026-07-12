import { toHSV } from '../util/to-hsv.js';
import { Color, defineFunction, Num } from '@jesscss/core';

export default defineFunction(
  'hsvvalue',
  function(color: Color) {
    return new Num(toHSV(color).v * 100);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);