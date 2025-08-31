import {
  Color,
  defineFunction,
  type Context
} from '@jesscss/core';
import { getNumber, type ColorValue } from '../util/number';

const rgba = defineFunction(
  'rgba',
  function(this: Context, r: ColorValue, g: ColorValue, b: ColorValue, a: ColorValue) {
    const values = [r, g, b, a].map(v => getNumber(v, true));
    return new Color(values);
  },
  {
    params: [{
      name: 'r',
      type: [Color, 'number']
    }, {
      name: 'g',
      type: [Color, 'number']
    }, {
      name: 'b',
      type: [Color, 'number']
    }, {
      name: 'a',
      type: [Color, 'number']
    }]
  }
);

export default rgba;