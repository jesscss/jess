import {
  Color,
  ColorFormat,
  Dimension,
  type Context,
  defineFunction
} from '@jesscss/core';
import mix from './mix';

const tint = defineFunction(
  'tint',
  function(this: Context, color: Color, amount: Dimension) {
    const white = new Color({
      format: ColorFormat.RGB,
      rgb: [255, 255, 255],
      alpha: 1
    });
    return mix.call(this, white, color, amount);
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