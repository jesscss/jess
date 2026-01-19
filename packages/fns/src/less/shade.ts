import {
  Color,
  ColorFormat,
  Dimension,
  type Context,
  defineFunction
} from '@jesscss/core';
import mix from './mix.js';

const shade = defineFunction(
  'shade',
  function(this: Context, color: Color, amount: Dimension) {
    const black = new Color({
      format: ColorFormat.RGB,
      rgb: [0, 0, 0],
      alpha: 1
    });
    return mix.call(this, black, color, amount);
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