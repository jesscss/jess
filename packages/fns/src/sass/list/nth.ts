/**
 * Sass list.nth() function
 *
 * Returns the nth element of a list (1-based indexing).
 *
 * @example
 * nth(1 2 3, 2) // 2
 * nth([a, b, c], 1) // a
 */
import { defineFunction, List, Dimension } from '@jesscss/core';
import { toNumber } from '@jesscss/core';

const nth = defineFunction(
  'nth',
  function(list: List, n: Dimension): any {
    const index = toNumber()(n) as number;
    // Sass uses 1-based indexing
    const sassIndex = Math.floor(index);
    if (sassIndex < 1 || sassIndex > list.length) {
      throw new Error(`List index ${sassIndex} is out of bounds for list of length ${list.length}`);
    }
    // Convert to 0-based index
    const zeroBasedIndex = sassIndex - 1;
    return list.data[zeroBasedIndex];
  },
  {
    params: [
      {
        name: 'list',
        type: List
      },
      {
        name: 'n',
        type: Dimension,
        convert: [toNumber()]
      }
    ]
  }
);

export default nth;
