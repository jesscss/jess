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
    let adjustAmount = amount.number / 100;

    if (method && (method as any).value === 'relative') {
      adjustAmount = color._alpha * adjustAmount;
    }

    const newAlpha = color._alpha + adjustAmount;
    const outputAlpha = Math.round(newAlpha * 1e12) / 1e12;
    const inputNode = typeof color._nodeValue === 'string' ? color._nodeValue : undefined;
    const preserveHexFormat = color.options.format === ColorFormat.HEX
      && !!inputNode
      && inputNode.startsWith('#');
    const outputFormat = preserveHexFormat ? ColorFormat.HEX : ColorFormat.RGB;

    // Create new color with adjusted alpha, preserving original format
    return new Color({
      rgb: color._rgb,
      hsl: color._hsl,
      alpha: outputAlpha
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
    }, {
      name: 'method',
      type: Node,
      optional: true
    }]
  }
);

export default fadein;