/**
 * Sass list.nth() function
 *
 * Returns the nth element of a list (1-based indexing).
 *
 * @example
 * nth(1 2 3, 2) // 2
 * nth([a, b, c], 1) // a
 */
import { defineFunction, Node, Dimension, coerceListItems } from '@jesscss/core';
import { toNumber } from '@jesscss/core';

const nth = defineFunction(
  'nth',
  function(list: Node, n: Dimension): Node {
    const index = toNumber()(n) as number;
    const items = coerceListItems(list);
    // Sass uses 1-based indexing
    const sassIndex = Math.floor(index);
    if (sassIndex < 1 || sassIndex > items.length) {
      throw new Error(`List index ${sassIndex} is out of bounds for list of length ${items.length}`);
    }
    // Convert to 0-based index
    const zeroBasedIndex = sassIndex - 1;
    return items[zeroBasedIndex]!;
  },
  {
    params: [
      {
        name: 'list',
        type: Node
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
