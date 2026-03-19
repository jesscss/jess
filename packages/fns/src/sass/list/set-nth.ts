/**
 * Sass list.set-nth() function
 *
 * Sets the nth element of a list (1-based indexing).
 *
 * @example
 * set-nth(1 2 3, 2, 99) // 1 99 3
 */
import { defineFunction, List, Dimension, Node } from '@jesscss/core';
import { toNumber } from '@jesscss/core';

const setNth = defineFunction(
  'set-nth',
  function(list: List, n: Dimension, value: Node): List {
    const index = toNumber()(n) as number;
    // Sass uses 1-based indexing
    const sassIndex = Math.floor(index);
    if (sassIndex < 1 || sassIndex > list.length) {
      throw new Error(`List index ${sassIndex} is out of bounds for list of length ${list.length}`);
    }
    // Convert to 0-based index
    const zeroBasedIndex = sassIndex - 1;
    // Clone the list and set the value
    const newList = new List([...list.value], list.options);
    newList.setData(zeroBasedIndex, value);
    return newList;
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
      },
      {
        name: 'value',
        type: Node
      }
    ]
  }
);

export default setNth;
