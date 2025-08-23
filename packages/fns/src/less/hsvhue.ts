import { toHSV } from '../util/to-hsv';
import { Color, defineFunction, Num } from '@jesscss/core';

export default defineFunction(
  'hsvhue',
  function(color: Color) {
    return new Num(toHSV(color).h);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);