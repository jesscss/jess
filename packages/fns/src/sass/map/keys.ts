/**
 * Sass map.keys() function
 * 
 * Returns a list of all keys in a map.
 * 
 * @example
 * map.keys((a: 1, b: 2)) // a, b
 */
import { defineFunction, Collection, List, Declaration, Any, Quoted, type Context } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode } from '@jesscss/core';

const keys = defineFunction(
  'keys',
  function(this: FunctionThis | Context | undefined, map: Collection): List {
    // Get all declarations from the collection
    const keyNodes: any[] = [];
    for (const node of map.value) {
      if (isNode(node, 'Declaration')) {
        // The key is the declaration's name - convert to a Node
        const name = node.value.name;
        // If it's already a Node (Any or Interpolated), use it directly
        // Otherwise wrap it in a Quoted node
        if (name instanceof Any || (name as any).type) {
          keyNodes.push(name);
        } else {
          // Convert string to Quoted node
          keyNodes.push(new Quoted(String(name), { quote: undefined }));
        }
      }
    }
    return new List(keyNodes, { sep: ',' });
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

export default keys;
