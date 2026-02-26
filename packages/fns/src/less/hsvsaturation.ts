import { toHSV } from '../util/to-hsv.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

export default defineFunction(
  'hsvsaturation',
  function(color: Color) {
    const result = new Dimension({ number: toHSV(color).s * 100, unit: '%' });
    return result;
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);