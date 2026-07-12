import { type ColorValue } from '../util/number.js';
import hsva from './hsva.js';
import { defineFunction, Dimension } from '@jesscss/core';

const hsv = defineFunction(
  'hsv',
  function(this: any, h: ColorValue, s: ColorValue, v: ColorValue) {
    return hsva.call(this, h, s, v, 1.0);
  },
  {
    params: [{
      name: 'h',
      type: [Dimension, 'number']
    }, {
      name: 's',
      type: [Dimension, 'number']
    }, {
      name: 'v',
      type: [Dimension, 'number']
    }]
  }
);

export default hsv;