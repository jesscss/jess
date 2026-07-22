import { toHSL } from '../util/to-hsl.js';
import { Color, defineFunction, Num } from '@jesscss/core';

/**
 * Less `hue()` — the HSL hue channel of a color, in degrees (`0–360`).
 * @param color the input `Color`
 * @returns the hue as a unitless number
 */
export default defineFunction(
  'hue',
  function(color: Color) {
    return new Num(toHSL(color).h);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);