/**
 * Sass map.merge() function
 *
 * Merges two maps together.
 *
 * @example
 * map.merge((a: 1), (b: 2)) // (a: 1, b: 2)
 */
import { CollectionOverlay, defineFunction, makeCollection } from '@jesscss/core';

const merge = defineFunction(
  'merge',
  {
    params: [
      { name: 'map1', type: 'Collection' },
      { name: 'map2', type: 'Collection' }
    ] as const,
    body: (map1, map2) => {
      const entries = new CollectionOverlay<(typeof map1.entries)[number]>();
      for (const entry of map1.entries) {
        entries.set(entry.key, entry);
      }
      for (const entry of map2.entries) {
        entries.set(entry.key, entry);
      }
      return makeCollection(entries.items);
    }
  }
);

export default merge;
