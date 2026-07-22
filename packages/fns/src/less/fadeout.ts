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
 * Less `fadeout()` — decrease a color's opacity by `amount` (a percentage). With
 * `method: relative`, the decrease is relative to the current alpha.
 * @param color the input `Color`
 * @param amount opacity decrease as a `Dimension` percentage
 * @param method optional `relative` keyword
 * @returns the more-transparent `Color`
 */
const fadeout = defineFunction(
  'fadeout',
  function(this: Context, color: Color, amount: Dimension, method?: Any<'keyword'> | Quoted) {
    let adjustAmount = amount.number / 100;

    if (method?.valueOf() === 'relative') {
      adjustAmount = color._alpha * adjustAmount;
    }

    const newAlpha = color._alpha - adjustAmount;
    const inputNode = typeof color.node === 'string' ? color.node : undefined;
    const outputFormat = preserveHexUnderAlpha(color, inputNode) ? ColorFormat.HEX : ColorFormat.RGB;

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
    }, {
      name: 'method',
      type: [Any, Quoted],
      optional: true
    }]
  }
);

export default fadeout;
