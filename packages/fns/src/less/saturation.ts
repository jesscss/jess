import { toHSL } from '../util/to-hsl.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

export default defineFunction(
  'saturation',
  function(color: Color) {
    const result = new Dimension({ number: toHSL(color).s * 100, unit: '%' });
    return result;
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);