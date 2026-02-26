import { toHSV } from '../util/to-hsv.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

export default defineFunction(
  'hsvvalue',
  function(color: Color) {
    return new Dimension({ number: toHSV(color).v * 100, unit: '%' });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);