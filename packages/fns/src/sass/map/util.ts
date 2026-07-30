import type { Collection, CollectionEntry, ValueGroup } from '@jesscss/core';
import { collectionEntryIndex, collectionKeyIndex, isCollection } from '@jesscss/core';

/** Resolve Sass's variadic nested map-key path. */
export function nestedCollection(map: Collection, keys: readonly ValueGroup[]): Collection | undefined {
  let current: ValueGroup = map;
  for (const key of keys) {
    if (!isCollection(current)) {
      return undefined;
    }
    const index = collectionKeyIndex(current, key);
    if (index < 0) {
      return undefined;
    }
    current = current.entries[index]!.value;
  }
  return isCollection(current) ? current : undefined;
}

export function collectionValueAt(map: Collection, key: ValueGroup): ValueGroup | undefined {
  const index = collectionKeyIndex(map, key);
  return index < 0 ? undefined : map.entries[index]!.value;
}

export function entryIndex(entries: readonly CollectionEntry[], key: ValueGroup): number {
  return collectionEntryIndex(entries, key);
}
