/**
 * Sass map.has-key() function
 * 
 * Checks if a map contains a key, with support for nested keys.
 * 
 * @example
 * map.has-key((a: 1), a) // true
 * map.has-key((a: 1), b) // false
 */
import { defineFunction, Collection, Node, Bool } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode } from '@jesscss/core';

const hasKey = defineFunction(
  'has-key',
  function(this: FunctionThis, map: Collection, key: Node, ...keys: Node[]): Bool {
    const allKeys = [key, ...keys];
    let currentMap: Collection = map;
    
    // Navigate through nested maps
    for (let i = 0; i < allKeys.length - 1; i++) {
      const currentKey = allKeys[i]!;
      const keyStr = String(currentKey.valueOf());
      
      // Find declaration with this key in the collection
      const found = currentMap.find('declaration', keyStr, undefined, { context: this.context });
      if (!found || (Array.isArray(found) && found.length === 0) || (!Array.isArray(found) && !found)) {
        return new Bool(false);
      }
      
      const decl = Array.isArray(found) ? found[0] : found;
      if (!isNode(decl, 'Declaration')) {
        return new Bool(false);
      }
      
      // Get the value and check if it's a Collection (nested map)
      const value = decl.value.value;
      if (!isNode(value, 'Collection')) {
        return new Bool(false);
      }
      
      currentMap = value;
    }
    
    // Check if the final key exists
    const finalKey = allKeys[allKeys.length - 1]!;
    const finalKeyStr = String(finalKey.valueOf());
    const found = currentMap.find('declaration', finalKeyStr, undefined, { context: this.context });
    
    const hasKey = !!(found && ((Array.isArray(found) && found.length > 0) || (!Array.isArray(found) && found)));
    return new Bool(hasKey);
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
        name: 'keys',
        type: Node,
        rest: true
      }
    ]
  }
);

export default hasKey;
