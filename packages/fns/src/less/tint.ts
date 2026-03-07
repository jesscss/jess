import {
  Color,
  ColorFormat,
  Dimension,
  type Context,
  defineFunction
} from '@jesscss/core';
import mix from './mix.js';

const tint = defineFunction(
  'tint',
  function(this: Context, color: Color, amount: Dimension) {
    const white = new Color({
      rgb: [255, 255, 255],
      alpha: 1
    }, {
      format: ColorFormat.RGB
    });
    const out = mix.call(this, white, color, amount);
    out.options.format = color.options.format;
    if (Math.abs(out._alpha - 1) < 1e-12) {
      out.alpha = 1;
    }
    return out;
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