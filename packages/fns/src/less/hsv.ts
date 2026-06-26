import { type ColorValue } from '../util/number.js';
import hsva from './hsva.js';
import { Color, ColorFormat, defineFunction, Dimension } from '@jesscss/core';

const hsv = defineFunction(
  'hsv',
  function(this: any, h: ColorValue, s: ColorValue, v: ColorValue) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const out = Function.prototype.call.call(hsva, this, h, s, v, new Dimension({ number: 1 })) as Color;
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
