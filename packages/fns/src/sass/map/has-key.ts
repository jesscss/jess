/**
 * Sass map.has-key() function
 *
 * Checks if a map contains a key, with support for nested keys.
 *
 * @example
 * map.has-key((a: 1), a) // true
 * map.has-key((a: 1), b) // false
 */
import { collectionKeyIndex, defineFunction, makeBool } from '@jesscss/core';
import { nestedCollection } from './util.js';

const hasKey = defineFunction(
  'has-key',
  {
    params: [
      { name: 'map', type: 'Collection' },
      { name: 'key', type: 'any' },
      { name: 'keys', type: 'any', rest: true }
    ] as const,
    body: (map, key, keys) => {
      const path = [key, ...keys];
      const parent = nestedCollection(map, path.slice(0, -1));
      return makeBool(parent !== undefined && collectionKeyIndex(parent, path[path.length - 1]!) >= 0);
    }
  }
);

export default hasKey;
