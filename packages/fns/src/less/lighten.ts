import {
  defineFunction,
  type Context,
  Color,
  Dimension,
  Node,
  ColorFormat
} from '@jesscss/core';

export default defineFunction(
  'lighten',
  function(this: Context, color: Color, amount: Dimension, method?: Node) {
    const [h, s, l] = color._hsl;
    let adjustAmount = amount.number / 100;

    if (method && (method as any).value === 'relative') {
      adjustAmount = l * adjustAmount;
    }

    const newLightness = l + adjustAmount;

    // Create new color with adjusted lightness, preserving original format
    return new Color({
      hsl: [h, s, newLightness],
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