/**
 * Sass map.get() function
 *
 * Gets a value from a map by key, with support for nested keys.
 *
 * @example
 * map.get((a: 1, b: 2), a) // 1
 * map.get((a: (b: 2)), a, b) // 2
 */
import { defineFunction, NULL } from '@jesscss/core';
import { collectionValueAt, nestedCollection } from './util.js';

const get = defineFunction(
  'get',
  {
    params: [
      { name: 'map', type: 'Collection' },
      { name: 'key', type: 'any' },
      { name: 'keys', type: 'any', rest: true }
    ] as const,
    body: (map, key, keys) => {
      const path = [key, ...keys];
      const parent = nestedCollection(map, path.slice(0, -1));
      if (parent === undefined) {
        return NULL;
      }
      return collectionValueAt(parent, path[path.length - 1]!) ?? NULL;
    }
  }
);

export default get;
