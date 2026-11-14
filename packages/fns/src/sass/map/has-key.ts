/**
 * Sass map.has-key() function
 *
 * Checks if a map contains a key, with support for nested keys.
 *
 * @example
 * map.has-key((a: 1), a) // true
 * map.has-key((a: 1), b) // false
 */
import { collectionKeyIndex, makeBool, define, checkCollection, checkAny, rest } from '@jesscss/core/value';
import { nestedCollection } from './util.js';

const hasKey = define(
  'has-key',
  {
    params: [
      { name: 'map', type: 'Collection', check: checkCollection },
      { name: 'key', type: 'any', check: checkAny },
      /* @__PURE__ */ rest({ name: 'keys', type: 'any', check: checkAny })
    ] as const,
    body: (map, key, keys) => {
      const path = [key, ...keys];
      const parent = nestedCollection(map, path.slice(0, -1));
      return makeBool(parent !== undefined && collectionKeyIndex(parent, path[path.length - 1]!) >= 0);
    }
  }
);

export default hasKey;
