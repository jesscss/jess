import { toHSL } from '../util/to-hsl.js';
import { Color, defineFunction, Num } from '@jesscss/core';

export default defineFunction(
  'hue',
  function(color: Color) {
    return new Num(toHSL(color).h);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);