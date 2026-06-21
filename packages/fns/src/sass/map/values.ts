/**
 * Sass map.values() function
 *
 * Returns a list of all values in a map.
 *
 * @example
 * map.values((a: 1, b: 2)) // 1, 2
 */
import { defineFunction, Collection, List, Declaration, Any, Node, type Context } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode, N } from '@jesscss/core';

function declarationValueNode(value: Declaration['value']): Node {
  return typeof value === 'string' ? new Any(value) : value;
}

const values = defineFunction(
  'values',
  function(this: FunctionThis | Context | undefined, map: Collection): List {
    // Get all declaration values from the collection
    const values: Node[] = [];
    for (const node of map.value) {
      if (isNode(node, N.Declaration)) {
        values.push(declarationValueNode(node.value));
      }
    }
    return new List(values, { sep: ',' });
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
