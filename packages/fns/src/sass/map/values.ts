/**
 * Sass map.values() function
 *
 * Returns a list of all values in a map.
 *
 * @example
 * map.values((a: 1, b: 2)) // 1, 2
 */
import { defineFunction, Collection, List, Declaration, type Context } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode, N } from '@jesscss/core';

const values = defineFunction(
  'values',
  function(this: FunctionThis | Context | undefined, map: Collection): List {
    // Get all declaration values from the collection
    const valueNodes: any[] = [];
    for (const node of map.data) {
      if (isNode(node, N.Declaration)) {
        // The value is the declaration's value (already a Node)
        valueNodes.push(node.data.value);
      }
    }
    return new List(valueNodes, { sep: ',' });
  },
  {
    params: [
      {
        name: 'map',
        type: Collection
      }
    ]
  }
);

export default values;
