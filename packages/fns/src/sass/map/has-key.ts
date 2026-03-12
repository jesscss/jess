/**
 * Sass map.has-key() function
 *
 * Checks if a map contains a key, with support for nested keys.
 *
 * @example
 * map.has-key((a: 1), a) // true
 * map.has-key((a: 1), b) // false
 */
import { defineFunction, Collection, Node, Bool, Declaration, type Context } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode, N } from '@jesscss/core';

const hasKey = defineFunction(
  'has-key',
  function(this: FunctionThis | Context | undefined, map: Collection, key: Node, ...keys: Node[]): Bool {
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

    // Helper to find declaration by key string in a collection
    const findDeclaration = (map: Collection, keyStr: string): Declaration | null => {
      for (const node of map.data) {
        if (isNode(node, N.Declaration)) {
          const nodeKey = String(node.data.name.valueOf());
          if (nodeKey === keyStr) {
            return node;
          }
        }
      }
      return null;
    };

    // Navigate through nested maps
    for (let i = 0; i < allKeys.length - 1; i++) {
      const currentKey = allKeys[i]!;
      const keyStr = String(currentKey.valueOf());

      // Find declaration with this key in the collection
      const decl = findDeclaration(currentMap, keyStr);
      if (!decl) {
        return new Bool(false);
      }

      // Get the value and check if it's a Collection (nested map)
      const value = decl.data.value;
      if (!isNode(value, N.Collection)) {
        return new Bool(false);
      }

      currentMap = value;
    }

    // Check if the final key exists
    const finalKey = allKeys[allKeys.length - 1]!;
    const finalKeyStr = String(finalKey.valueOf());
    const decl = findDeclaration(currentMap, finalKeyStr);

    return new Bool(!!decl);
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
