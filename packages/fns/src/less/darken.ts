import {
  defineFunction,
  type Context,
  Color,
  Dimension,
  Node
} from '@jesscss/core';
import { adjustHSL } from '../util/get-hsla';

export default defineFunction(
  'darken',
  function(this: Context, color: Color, amount: Dimension, method?: Node) {
    return adjustHSL.call(this, 'l', '-', color, amount, method);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }, {
      name: 'amount',
      type: Dimension
    }, {
      name: 'method',
      type: Node,
      optional: true
    }]
  }
);