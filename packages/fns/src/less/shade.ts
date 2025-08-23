import {
  Color,
  Dimension,
  type Context,
  defineFunction
} from '@jesscss/core';
import mix from './mix';
import rgb from './rgb';

const shade = defineFunction(
  'shade',
  function(this: Context, color: Color, amount: Dimension) {
    return mix.call(this, rgb.call(this, 0, 0, 0), color, amount);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }, {
      name: 'amount',
      type: Dimension
    }]
  }
);

export default shade;