/**
 * Sass percentage() function
 *
 * Converts a unitless number to a percentage.
 *
 * @example
 * percentage(0.5) // 50%
 */
import { defineFunction, Dimension } from '@jesscss/core';

const percentage = defineFunction(
  'percentage',
  function(number: Dimension): Dimension {
    // Sass requires the number to be unitless
    const { number: value, unit } = number;
    if (unit) {
      throw new Error('$number: Expected unitless number, got number with unit');
    }
    return new Dimension({ number: value * 100, unit: '%' });
  },
  {
    params: [
      {
        name: 'number',
        type: Dimension
      }
    ]
  }
);

export default percentage;
