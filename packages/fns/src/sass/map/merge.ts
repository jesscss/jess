/**
 * Sass map.merge() function
 *
 * Merges two maps together.
 *
 * @example
 * map.merge((a: 1), (b: 2)) // (a: 1, b: 2)
 */
import { defineFunction, makeCollection } from '@jesscss/core';
import { entryIndex } from './util.js';

const merge = defineFunction(
  'merge',
  {
    params: [
      { name: 'map1', type: 'Collection' },
      { name: 'map2', type: 'Collection' }
    ] as const,
    body: (map1, map2) => {
      const entries = [...map1.entries];
      for (const entry of map2.entries) {
        const index = entryIndex(entries, entry.key);
        if (index < 0) {
          entries.push(entry);
        } else {
          entries[index] = entry;
        }
      }
      return makeCollection(entries, map1.base);
    }
  }
);

export default merge;
