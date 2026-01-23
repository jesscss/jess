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
import { isNode } from '@jesscss/core';
import { Any } from '@jesscss/core';

const set = defineFunction(
  'set',
  function(this: FunctionThis, map: Collection, key: Node, value: Node): Collection {
    const keyStr = String(key.valueOf());
    
    // Create a new collection with the updated value
    const newRules = [...map.value];
    
    // Check if key already exists
    let foundIndex = -1;
    for (let i = 0; i < newRules.length; i++) {
      const node = newRules[i];
      if (isNode(node, 'Declaration')) {
        const nodeKey = String(node.value.name.valueOf());
        if (nodeKey === keyStr) {
          foundIndex = i;
          break;
        }
      }
    }
    
    // Create new declaration
    // The key needs to be an Any<'property'> or Interpolated<'property'>
    let keyNode: any;
    if (isNode(key, 'Any') && (key as any).role === 'property') {
      keyNode = key;
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
