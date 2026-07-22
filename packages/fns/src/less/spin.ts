import {
  type Context,
  Color,
  Dimension,
  defineFunction,
  ColorFormat
} from '@jesscss/core';

/**
 * Less `spin()` — rotate a color's HSL hue by `amount` degrees (wrapping mod 360),
 * leaving saturation and lightness unchanged.
 * @param color the input `Color`
 * @param amount hue rotation as a `Dimension` in degrees
 * @returns the hue-rotated `Color`
 */
export default defineFunction(
  'spin',
  function(this: Context, color: Color, amount: Dimension) {
    const [h, s, l] = color._hsl;
    const hue = (h + amount.number) % 360;
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