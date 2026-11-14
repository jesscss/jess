/**
 * Sass map.set() function
 *
 * Sets a value in a map by key.
 *
 * @example
 * map.set((a: 1), b, 2) // (a: 1, b: 2)
 */
import { makeCollection, define, checkCollection, checkAny } from '@jesscss/core/value';
import { entryIndex } from './util.js';

const set = define(
  'set',
  {
    params: [
      { name: 'map', type: 'Collection', check: checkCollection },
      { name: 'key', type: 'any', check: checkAny },
      { name: 'value', type: 'any', check: checkAny }
    ] as const,
    body: (map, key, value) => {
      const entries = [...map.entries];
      const entry = { key, value };
      const index = entryIndex(entries, key);
      if (index < 0) {
        entries.push(entry);
      } else {
        entries[index] = entry;
      }
      return makeCollection(entries);
    }
  }
);

export default set;
