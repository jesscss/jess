/**
 * Sass map.get() function
 * 
 * Gets a value from a map by key, with support for nested keys.
 * 
 * @example
 * map.get((a: 1, b: 2), a) // 1
 * map.get((a: (b: 2)), a, b) // 2
 */
import { defineFunction, Collection, Node, Nil, Declaration, type Context } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode } from '@jesscss/core';

const get = defineFunction(
  'get',
  function(this: FunctionThis | Context | undefined, map: Collection, key: Node, ...keys: Node[]): Node | Nil {
    // Get context - either from FunctionThis or directly as Context
    let context: Context | undefined;
    if (this) {
      if ('context' in this && typeof this.context !== 'undefined') {
        context = this.context;
      } else if ('opts' in this) {
        context = this as Context;
      }
    }
    
    const allKeys = [key, ...keys];
    let currentMap: Collection = map;
    
    // Navigate through nested maps
    for (let i = 0; i < allKeys.length - 1; i++) {
      const currentKey = allKeys[i]!;
      const keyStr = String(currentKey.valueOf());
      
      // Find declaration with this key in the collection
      const found = currentMap.find('declaration', keyStr, undefined, context ? { context } : {});
      if (!found || (Array.isArray(found) && found.length === 0) || (!Array.isArray(found) && !found)) {
        return new Nil();
      }
      
      const decl = Array.isArray(found) ? found[0] : found;
      if (!isNode(decl, 'Declaration')) {
        return new Nil();
      }
      
      // Get the value and check if it's a Collection (nested map)
      const value = decl.value.value;
      if (!isNode(value, 'Collection')) {
        return new Nil();
      }
      
      currentMap = value;
    }
    
    // Get the final value
    const finalKey = allKeys[allKeys.length - 1]!;
    const finalKeyStr = String(finalKey.valueOf());
    const found = currentMap.find('declaration', finalKeyStr, undefined, context ? { context } : {});
    
    if (!found || (Array.isArray(found) && found.length === 0) || (!Array.isArray(found) && !found)) {
      return new Nil();
    }
    
    const decl = Array.isArray(found) ? found[0] : found;
    if (!isNode(decl, 'Declaration')) {
      return new Nil();
    }
    
    return decl.value.value;
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

export default get;
