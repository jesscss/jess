import {
  type Context,
  Color,
  Dimension,
  defineFunction,
  ColorFormat
} from '@jesscss/core';

/**
 * Less `fade()` — set a color's alpha to `amount` (a percentage), replacing any
 * existing transparency.
 * @param color the input `Color`
 * @param amount target opacity as a `Dimension` percentage
 * @returns the `Color` with the new alpha
 */
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
