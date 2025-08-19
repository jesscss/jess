import {
  Color,
  defineFunction
} from '@jesscss/core';
import { type, assert, number, type Context } from 'superstruct';
import { getNumber, type ColorValue } from '../util/number';

const Struct = type({
  r: number(),
  g: number(),
  b: number(),
  a: number()
});

const rgba = defineFunction(
  'rgba',
  function(this: Context, { r, g, b, a }: { r: ColorValue; g: ColorValue; b: ColorValue; a: ColorValue }) {
    const values = [r, g, b, a].map(v => getNumber(v));
    assert({ r, g, b, a }, Struct);
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