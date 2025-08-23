import {
  type Node,
  type Context,
  Color,
  type Sequence,
  defineFunction
} from '@jesscss/core';
import rgba from './rgba';
import { getColorFunctionValues } from '../util/get-color-func-values';

const rgb = defineFunction(
  'rgb',
  function(this: Context, r: Node, g: Node, b: Node) {
    const values = getColorFunctionValues(r, g, b);
    return rgba.call(this, values[0], values[1], values[2], values[3]);
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
    }]
  }
);

// rgb.allowOptional = true;

export default rgb;