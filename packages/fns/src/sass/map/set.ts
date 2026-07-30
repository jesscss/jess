/**
 * Sass map.set() function
 *
 * Sets a value in a map by key.
 *
 * @example
 * map.set((a: 1), b, 2) // (a: 1, b: 2)
 */
import { defineFunction, makeCollection } from '@jesscss/core';
import { entryIndex } from './util.js';

const set = defineFunction(
  'set',
  {
    params: [
      { name: 'map', type: 'Collection' },
      { name: 'key', type: 'any' },
      { name: 'value', type: 'any' }
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
      return makeCollection(entries, map.base);
    }
  }
);

export default set;
