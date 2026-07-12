import {
  type Context,
  Color,
  Dimension,
  defineFunction,
  ColorFormat
} from '@jesscss/core';

const fade = defineFunction(
  'fade',
  function(this: Context, color: Color, amount: Dimension) {
    const newAlpha = amount.value.number / 100;

    // Create new color with adjusted alpha, preserving original format
    return new Color({
      format: color.value.format,
      rgb: color._rgb,
      hsl: color._hsl,
      alpha: newAlpha
    }).inherit(color);
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

export default fade;