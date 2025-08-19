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
  function(this: Context, { r, g, b }: { r: Node; g: Node; b: Node }) {
    const values = getColorFunctionValues(r, g, b);
    return rgba.call(this, {
      r: values[0],
      g: values[1],
      b: values[2],
      a: values[3]
    });
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