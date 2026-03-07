/**
 * Sass hue() function
 * 
 * Extracts the hue channel from a color.
 * Returns a Dimension with 'deg' unit (unlike Less which returns unitless).
 * 
 * @example
 * hue(hsl(120, 50%, 50%)) // 120deg
 */
import { defineFunction, Color, Dimension } from '@jesscss/core';
import { toHSL } from '../util/to-hsl.js';

const hue = defineFunction(
  'hue',
  function(color: Color): Dimension {
    const hsl = toHSL(color);
    return new Dimension({ number: hsl.h, unit: 'deg' });
  },
  {
    params: [
      {
        name: 'color',
        type: Color
      }
    ]
  }
);

export default hue;
