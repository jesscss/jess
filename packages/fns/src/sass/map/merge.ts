/**
 * Sass map.merge() function
 *
 * Merges two maps together.
 *
 * @example
 * map.merge((a: 1), (b: 2)) // (a: 1, b: 2)
 */
import { defineFunction, Collection, Declaration } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode, N } from '@jesscss/core';

const merge = defineFunction(
  'merge',
  function(this: FunctionThis, map1: Collection, map2: Collection): Collection {
    // Start with all declarations from map1
    const newRules = [...map1.value];

    // Add declarations from map2, overwriting any with the same key
    for (const node of map2.value) {
      if (isNode(node, N.Declaration)) {
        const keyStr = String(node.value.name.valueOf());

        // Check if this key already exists in map1
        let foundIndex = -1;
        for (let i = 0; i < newRules.length; i++) {
          const existingNode = newRules[i];
          if (isNode(existingNode, N.Declaration)) {
            const existingKey = String(existingNode.value.name.valueOf());
            if (existingKey === keyStr) {
              foundIndex = i;
              break;
            }
          }
        }

        if (foundIndex >= 0) {
          // Replace existing declaration
          newRules[foundIndex] = node;
        } else {
          // Add new declaration
          newRules.push(node);
        }
      }
    }

    return new Collection(newRules, map1.options);
  },
  {
    params: [
      {
        name: 'map1',
        type: Collection
      },
      {
        name: 'map2',
        type: Collection
      }
    ]
  }
);

export default merge;
