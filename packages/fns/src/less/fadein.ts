import {
  type Context,
  Color,
  Dimension,
  Node,
  defineFunction
} from '@jesscss/core';
import { adjustHSL } from '../util/get-hsla';

const fadein = defineFunction(
  'fadein',
  function(this: Context, color: Color, amount: Dimension, method?: Node) {
    return adjustHSL.call(this, 'a', '+', color, amount, method);
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

export default fadein;