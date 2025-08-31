import {
  type Context,
  Color,
  Dimension,
  Node,
  defineFunction,
  ColorFormat
} from '@jesscss/core';

const fadein = defineFunction(
  'fadein',
  function(this: Context, color: Color, amount: Dimension, method?: Node) {
    let adjustAmount = amount.value.number / 100;

    if (method && method.value === 'relative') {
      adjustAmount = color._alpha * adjustAmount;
    }

    const newAlpha = color._alpha + adjustAmount;

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
    }, {
      name: 'method',
      type: Node,
      optional: true
    }]
  }
);

export default fadein;