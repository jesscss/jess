/**
 * Sass map.deep-merge() function.
 *
 * Recurses only when both colliding values are maps. Every other collision uses
 * the second map's value, while the first map owns established key order.
 */
import { CollectionOverlay, defineFunction, isCollection, makeCollection, type Collection } from '@jesscss/core';

type Entry = Collection['entries'][number];

function mergeEntry(current: Entry, incoming: Entry): Entry {
  if (!isCollection(current.value) || !isCollection(incoming.value)) {
    return incoming;
  }
  const value = deepMergeCollections(current.value, incoming.value);
  return incoming.important === true
    ? { key: incoming.key, value, important: true }
    : { key: incoming.key, value };
}

function deepMergeCollections(map1: Collection, map2: Collection): Collection {
  const entries = new CollectionOverlay<Entry>();
  for (const entry of map1.entries) {
    entries.set(entry.key, entry);
  }
  for (const incoming of map2.entries) {
    entries.set(incoming.key, incoming, mergeEntry);
  }
  return makeCollection(entries.items);
}

const deepMerge = defineFunction(
  'deep-merge',
  {
    params: [
      { name: 'map1', type: 'Collection' },
      { name: 'map2', type: 'Collection' }
    ] as const,
    body: deepMergeCollections
  }
);

export default deepMerge;
