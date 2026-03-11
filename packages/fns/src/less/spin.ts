import {
  type Context,
  Color,
  Dimension,
  defineFunction,
  ColorFormat
} from '@jesscss/core';

export default defineFunction(
  'spin',
  function(this: Context, color: Color, amount: Dimension) {
    const [h, s, l] = color._hsl;
    const hue = (h + amount.data.number) % 360;
    const adjustedHue = hue < 0 ? 360 + hue : hue;

    // Create new color with adjusted hue, preserving original format
    return new Color({
      hsl: [adjustedHue, s, l],
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
    }]
  }
);