/**
 * Sass saturation() function
 * 
 * Extracts the saturation channel from a color.
 * Returns a Dimension with '%' unit (unlike Less which returns unitless).
 * 
 * @example
 * saturation(hsl(120, 50%, 50%)) // 50%
 */
import { defineFunction, Color, Dimension } from '@jesscss/core';
import { toHSL } from '../util/to-hsl.js';

const saturation = defineFunction(
  'saturation',
  function(color: Color): Dimension {
    const hsl = toHSL(color);
    return new Dimension({ number: hsl.s * 100, unit: '%' });
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

export default saturation;
