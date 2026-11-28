/**
 * Sass `map.deep-remove($map, $key, $keys...)`.
 *
 * Follows `$key, $keys...` except the last through nested maps and removes the
 * last key from the map it reaches. A missing key, or a value on the path that
 * is not a map, returns `$map` unchanged. Module-only: Dart Sass has no global.
 */
import { collectionKeyIndex, define, checkAny, checkCollection, isCollection, makeCollection, rest, type Collection, type ValueGroup } from '@jesscss/core/value';

function removeAt(map: Collection, path: readonly ValueGroup[], depth: number): Collection {
  const index = collectionKeyIndex(map, path[depth]!);
  if (index < 0) {
    return map;
  }
  if (depth === path.length - 1) {
    return makeCollection(map.entries.filter((_, at) => at !== index));
  }
  const entry = map.entries[index]!;
  if (!isCollection(entry.value)) {
    return map;
  }
  const value = removeAt(entry.value, path, depth + 1);
  if (value === entry.value) {
    return map;
  }
  const entries = [...map.entries];
  entries[index] = { ...entry, value };
  return makeCollection(entries);
}

const deepRemove = define('deep-remove', {
  params: [
    { name: 'map', type: 'Collection', check: checkCollection },
    { name: 'key', type: 'any', check: checkAny },
    /* @__PURE__ */ rest({ name: 'keys', type: 'any', check: checkAny })
  ] as const,
  body: (map, key, keys) => removeAt(map, [key, ...keys], 0)
});

export default deepRemove;
