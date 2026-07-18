import {
  defineFunction,
  type Context,
  Any,
  Color,
  Dimension,
  Quoted,
  ColorFormat
} from '@jesscss/core';

/**
 * Less `desaturate()` — decrease a color's HSL saturation by `amount` (a
 * percentage). With `method: relative`, the decrease is relative to the current
 * saturation.
 * @param color the input `Color`
 * @param amount saturation decrease as a `Dimension` percentage
 * @param method optional `relative` keyword
 * @returns the less-saturated `Color`
 */
export default defineFunction(
  'desaturate',
  function(this: Context, color: Color, amount: Dimension, method?: Any<'keyword'> | Quoted) {
    const [h, s, l] = color._hsl;
    let adjustAmount = amount.number / 100;

    if (method?.valueOf() === 'relative') {
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
      type: [Any, Quoted],
      optional: true
    }]
  }
);
