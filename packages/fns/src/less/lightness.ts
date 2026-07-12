import { toHSL } from '../util/to-hsl.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

export default defineFunction(
  'lightness',
  function(color: Color) {
    return new Dimension({ number: toHSL(color).l * 100, unit: '%' });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);