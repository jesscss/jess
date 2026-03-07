/**
 * Sass string.length() function
 * 
 * Returns the length of a string in Unicode code points.
 * 
 * @example
 * string.length("hello") // 5
 * string.length("😊")    // 1 (not 2, as it's one code point)
 */
import { defineFunction, Dimension } from '@jesscss/core';

/**
 * Calculate the length of a string in Unicode code points
 * (not UTF-16 code units, which is what JavaScript's .length returns)
 */
function sassLength(str: string): number {
  // Use Array.from to properly count Unicode code points
  // This handles multi-byte characters correctly
  return Array.from(str).length;
}

const length = defineFunction(
  'length',
  function(str: string): Dimension {
    const len = sassLength(str);
    return new Dimension({ number: len, unit: undefined });
  },
  {
    params: [
      {
        name: 'string',
        type: 'string'
      }
    ]
  }
);

export default length;
