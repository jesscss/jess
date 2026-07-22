import {
  type Context,
  Any,
  Color,
  Dimension,
  Quoted,
  defineFunction,
  ColorFormat
} from '@jesscss/core';
import { preserveHexUnderAlpha } from '../util/preserve-hex.js';

/**
 * Less `fadein()` — increase a color's opacity by `amount` (a percentage). With
 * `method: relative`, the increase is relative to the current alpha.
 * @param color the input `Color`
 * @param amount opacity increase as a `Dimension` percentage
 * @param method optional `relative` keyword
 * @returns the more-opaque `Color`
 */
const fadein = defineFunction(
  'fadein',
  function(this: Context, color: Color, amount: Dimension, method?: Any<'keyword'> | Quoted) {
    let adjustAmount = amount.number / 100;

    if (method?.valueOf() === 'relative') {
      adjustAmount = color._alpha * adjustAmount;
    }

    const newAlpha = color._alpha + adjustAmount;
    const outputAlpha = Math.round(newAlpha * 1e12) / 1e12;
    const inputNode = typeof color.node === 'string' ? color.node : undefined;
    const outputFormat = preserveHexUnderAlpha(color, inputNode) ? ColorFormat.HEX : ColorFormat.RGB;

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
      type: [Any, Quoted],
      optional: true
    }]
  }
);

export default fadein;
