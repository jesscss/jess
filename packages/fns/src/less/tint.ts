import {
  Color,
  Dimension,
  type Context,
  defineFunction
} from '@jesscss/core';
import mix from './mix';
import rgb from './rgb';

const tint = defineFunction(
  'tint',
  function(this: Context, color: Color, amount: Dimension) {
    return mix.call(this, rgb.call(this, 255, 255, 255), color, amount);
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

export default tint;