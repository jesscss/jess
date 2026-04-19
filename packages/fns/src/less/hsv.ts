import { type ColorValue } from '../util/number.js';
import hsva from './hsva.js';
import { ColorFormat, defineFunction, Dimension } from '@jesscss/core';

const hsv = defineFunction(
  'hsv',
  function(this: any, h: ColorValue, s: ColorValue, v: ColorValue) {
    const out = hsva.call(this, h, s, v, new Dimension({ number: 1 }));
    out.options.format = ColorFormat.HEX;
    return out;
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
