/**
 * Sass map.remove() function
 *
 * Removes keys from a map.
 *
 * @example
 * map.remove((a: 1, b: 2), a) // (b: 2)
 */
import { defineFunction, Collection, Node, Declaration } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode, N } from '@jesscss/core';

const remove = defineFunction(
  'remove',
  function(this: FunctionThis, map: Collection, ...keys: Node[]): Collection {
    if (keys.length === 0) {
      // No keys to remove, return map as-is
      return map;
    }

    // Convert keys to strings
    const keysToRemove = new Set(keys.map(k => String(k.valueOf())));

    // Filter out declarations with keys to remove
    const newRules = map.value.filter((node) => {
      if (isNode(node, N.Declaration)) {
        const keyStr = String(node.value.name.valueOf());
        return !keysToRemove.has(keyStr);
      }
      return true; // Keep non-declaration nodes
    });

    return new Collection(newRules, map.options);
  },
  {
    params: [
      {
        name: 'map',
        type: Collection
      },
      {
        name: 'keys',
        type: Node,
        rest: true
      }
    ]
  }
);

export default remove;
