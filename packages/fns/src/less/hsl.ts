import { getNumber, type ColorValue } from '../util/number';
import { defineFunction, Dimension } from '@jesscss/core';
import hsla from './hsla';

const hsl = defineFunction(
  'hsl',
  function(this: any, h: ColorValue, s: ColorValue, l: ColorValue) {
    h = getNumber(h);
    s = getNumber(s);
    l = getNumber(l);
    return hsla.call(this, h, s, l, 1);
  },
  {
    params: [{
      name: 'h',
      type: [Dimension, 'number']
    }, {
      name: 's',
      type: [Dimension, 'number']
    }, {
      name: 'l',
      type: [Dimension, 'number']
    }]
  }
);

export default hsl;