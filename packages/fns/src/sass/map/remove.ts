/**
 * Sass map.remove() function
 *
 * Removes keys from a map.
 *
 * @example
 * map.remove((a: 1, b: 2), a) // (b: 2)
 */
import { makeCollection, define, checkCollection, checkAny } from '@jesscss/core/value';
import { entryIndex } from './util.js';

const remove = define(
  'remove',
  {
    params: [
      { name: 'map', type: 'Collection', check: checkCollection },
      { name: 'keys', type: 'any', check: checkAny, rest: true }
    ] as const,
    body: (map, keys) => {
      if (keys.length === 0) {
        return map;
      }
      const keyEntries = keys.map(key => ({ key, value: key }));
      const entries = map.entries.filter(entry => entryIndex(keyEntries, entry.key) < 0);
      return entries.length === map.entries.length ? map : makeCollection(entries);
    }
  }
);

export default remove;
