import { Color, defineFunction, Dimension } from '@jesscss/core';
import { getLuma } from '../util/get-luma.js';

export default defineFunction(
  'luma',
  function(color: Color) {
    return new Dimension({
      number: getLuma(color) * color.alpha * 100,
      unit: '%'
    });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);