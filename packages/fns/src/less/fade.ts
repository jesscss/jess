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
    const newAlpha = amount.number / 100;
    const inputNode = typeof color.node === 'string' ? color.node : undefined;
    const preserveHexFormat = color.options.format === ColorFormat.HEX
      && !!inputNode
      && inputNode.startsWith('#');
    const outputFormat = preserveHexFormat ? ColorFormat.HEX : ColorFormat.RGB;

    // Create new color with adjusted alpha, preserving original format
    return new Color({
      rgb: color._rgb,
      hsl: color._hsl,
      alpha: newAlpha
    }, {
      format: outputFormat,
      modernSyntax: color.options.modernSyntax
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
