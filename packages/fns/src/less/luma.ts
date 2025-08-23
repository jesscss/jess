import { Color, defineFunction, Num } from '@jesscss/core';
import { getLuma } from '../util/get-luma';

export default defineFunction(
  'luma',
  function(color: Color) {
    return new Num(getLuma(color) * color.alpha * 100);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);