/**
 * Sass map.get() function
 *
 * Gets a value from a map by key, with support for nested keys.
 *
 * @example
 * map.get((a: 1, b: 2), a) // 1
 * map.get((a: (b: 2)), a, b) // 2
 */
import { NULL, define, checkCollection, checkAny, rest } from '@jesscss/core/value';
import { collectionValueAt, nestedCollection } from './util.js';

const get = define(
  'get',
  {
    params: [
      { name: 'map', type: 'Collection', check: checkCollection },
      { name: 'key', type: 'any', check: checkAny },
      /* @__PURE__ */ rest({ name: 'keys', type: 'any', check: checkAny })
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
