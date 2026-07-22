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
 * Less `lighten()` — increase a color's HSL lightness by `amount` (a percentage).
 * With `method: relative`, the increase is relative to the current lightness.
 * @param color the input `Color`
 * @param amount lightness increase as a `Dimension` percentage
 * @param method optional `relative` keyword
 * @returns the lightened `Color`, preserving the input's output format
 */
export default defineFunction(
  'lighten',
  function(this: Context, color: Color, amount: Dimension, method?: Any<'keyword'> | Quoted) {
    const [h, s, l] = color._hsl;
    let adjustAmount = amount.number / 100;

    if (method?.valueOf() === 'relative') {
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
      type: [Any, Quoted],
      optional: true
    }]
  }
);
