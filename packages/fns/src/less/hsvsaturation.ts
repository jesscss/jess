import { toHSV } from '../util/to-hsv';
import { Color, defineFunction, Num } from '@jesscss/core';

export default defineFunction(
  'hsvsaturation',
  function(color: Color) {
    return new Num(toHSV(color).s * 100);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);