/**
 * Sass list.length() function
 * 
 * Returns the length of a list.
 * 
 * @example
 * length(1 2 3) // 3
 * length([a, b, c]) // 3
 */
import { defineFunction, List, Dimension } from '@jesscss/core';

const length = defineFunction(
  'length',
  function(list: List): Dimension {
    return new Dimension({ number: list.length, unit: undefined });
  },
  {
    params: [
      {
        name: 'list',
        type: List
      }
    ]
  }
);

export default length;
