import { toHSL } from '../util/to-hsl.js';
import { Color, defineFunction, Num } from '@jesscss/core';

export default defineFunction(
  'saturation',
  function(color: Color) {
    return new Num(toHSL(color).s * 100);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);