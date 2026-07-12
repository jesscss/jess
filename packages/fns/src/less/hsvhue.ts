import { toHSV } from '../util/to-hsv.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

export default defineFunction(
  'hsvhue',
  function(color: Color) {
    return new Dimension({ number: toHSV(color).h });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);