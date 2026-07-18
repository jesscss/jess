import { toHSV } from '../util/to-hsv.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

/**
 * Less `hsvhue()` — the HSV hue channel of a color, in degrees.
 * @param color the input `Color`
 * @returns the HSV hue as a unitless `Dimension`
 */
export default defineFunction(
  'hsvhue',
  function(color: Color) {
    return new Dimension({ number: toHSV(color).h });
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);