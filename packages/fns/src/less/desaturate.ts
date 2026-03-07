import {
  defineFunction,
  type Context,
  Color,
  Dimension,
  Node,
  ColorFormat
} from '@jesscss/core';

export default defineFunction(
  'desaturate',
  function(this: Context, color: Color, amount: Dimension, method?: Node) {
    const [h, s, l] = color._hsl;
    let adjustAmount = amount.value.number / 100;

    if (method && method.value === 'relative') {
      adjustAmount = s * adjustAmount;
    }

    const newSaturation = s - adjustAmount;

    // Create new color with adjusted saturation, preserving original format
    return new Color({
      hsl: [h, newSaturation, l],
      alpha: color._alpha
    }, {
      format: color.options.format
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