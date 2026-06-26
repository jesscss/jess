/**
 * Sass map.set() function
 *
 * Sets a value in a map by key.
 *
 * @example
 * map.set((a: 1), b, 2) // (a: 1, b: 2)
 */
import { defineFunction, Collection, Node, Declaration } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode, N } from '@jesscss/core';
import { Any } from '@jesscss/core';

const set = defineFunction(
  'set',
  function(this: FunctionThis, map: Collection, key: Node, value: Node): Collection {
    const keyStr = String(key.valueOf());

    // Create a new collection with the updated value
    const newRules = [...map.rules];

    // Check if key already exists
    let foundIndex = -1;
    for (let i = 0; i < newRules.length; i++) {
      const node = newRules[i];
      if (isNode(node, N.Declaration)) {
        const nodeKey = String(node.name.valueOf());
        if (nodeKey === keyStr) {
          foundIndex = i;
          break;
        }
      }
    }

    // Create new declaration
    // The key needs to be an Any<'property'> or Interpolated<'property'>
    let keyNode: any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if (isNode(key, N.Any) && (key as any).role === 'property') {
      keyNode = key;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    } else if ((key as any).type === 'Interpolated') {
      keyNode = key;
    } else {
      // Convert to Any<'property'>
      keyNode = new Any(String(key.valueOf()), { role: 'property' });
    }
    const newDecl = new Declaration({
      name: keyNode,
      value: value
    });

    if (foundIndex >= 0) {
      // Replace existing declaration
      newRules[foundIndex] = newDecl;
    } else {
      // Add new declaration
      newRules.push(newDecl);
    }

    // Create new collection with updated rules
    return new Collection(newRules, map.options);
  },
  {
    params: [
      {
        name: 'map',
        type: Collection
      },
      {
        name: 'key',
        type: Node
      },
      {
        name: 'value',
        type: Node
      }
    ]
  }
);

export default set;
