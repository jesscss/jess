/**
 * Sass lightness() function
 *
 * Extracts the lightness channel from a color.
 * Returns a Dimension with '%' unit (unlike Less which returns unitless).
 *
 * @example
 * lightness(hsl(120, 50%, 50%)) // 50%
 */
import { defineFunction, Color, Dimension } from '@jesscss/core';
import { toHSL } from '../util/to-hsl.js';

const lightness = defineFunction(
  'lightness',
  function(color: Color): Dimension {
    const hsl = toHSL(color);
    return new Dimension({ number: hsl.l * 100, unit: '%' });
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

export default lightness;
