/**
 * Sass map.remove() function
 *
 * Removes keys from a map.
 *
 * @example
 * map.remove((a: 1, b: 2), a) // (b: 2)
 */
import { defineFunction, makeCollection } from '@jesscss/core';
import { entryIndex } from './util.js';

const remove = defineFunction(
  'remove',
  {
    params: [
      { name: 'map', type: 'Collection' },
      { name: 'keys', type: 'any', rest: true }
    ] as const,
    body: (map, keys) => {
      if (keys.length === 0) {
        return map;
      }
      const keyEntries = keys.map(key => ({ key, value: key }));
      const entries = map.entries.filter(entry => entryIndex(keyEntries, entry.key) < 0);
      return entries.length === map.entries.length ? map : makeCollection(entries, map.base);
    }
  }
);

export default remove;
