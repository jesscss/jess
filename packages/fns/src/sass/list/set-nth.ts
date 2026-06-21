/**
 * Sass list.set-nth() function
 *
 * Sets the nth element of a list (1-based indexing).
 *
 * @example
 * set-nth(1 2 3, 2, 99) // 1 99 3
 */
import { defineFunction, Dimension, Node } from '@jesscss/core';
import { toNumber } from '@jesscss/core';
import { createSassListResult, getSassListInfo } from './util.js';

const setNth = defineFunction(
  'set-nth',
  function(list: Node, n: Dimension, value: Node): Node {
    const index = toNumber()(n) as number;
    const info = getSassListInfo(list);
    // Sass uses 1-based indexing
    const sassIndex = Math.floor(index);
    if (sassIndex < 1 || sassIndex > info.value.length) {
      throw new Error(`List index ${sassIndex} is out of bounds for list of length ${info.value.length}`);
    }
    // Convert to 0-based index
    const zeroBasedIndex = sassIndex - 1;
    const items = [...info.value];
    items[zeroBasedIndex] = value;
    return createSassListResult(items, info.sep, info.bracketed);
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
      },
      {
        name: 'value',
        type: Node
      }
    ]
  }
);

export default setNth;
