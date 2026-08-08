/**
 * Value-domain MAP capabilities — the accessors a map function library reads a
 * {@link Collection} through.
 *
 * The one thing that cannot live in a dialect package is KEY IDENTITY: a Sass map
 * keys by VALUE equality (`(1: a)` is hit by the number `1`, `("a": b)` by the
 * unquoted `a`), which is the same `compare` the guards use. Owning it here keeps
 * every map function on one definition of "same key" and stops any of them from
 * falling back to comparing rendered bytes.
 *
 * HARD MODULE BOUNDARY: imports only the value domain + the value comparator.
 */
import { isValueGroupArray, type Collection, type CollectionEntry, type ValueGroup } from './value-eval.js';
import { compare, SASS_EQUAL } from './value-guards.js';

/** Narrow a value group to a map. */
export function isCollection(value: ValueGroup | undefined): value is Collection {
  return value !== undefined && !isValueGroupArray(value) && value.type === 'Collection';
}

/**
 * A value's map entries in authored order; `[]` for anything that is not a map.
 * Sass reads an EMPTY LIST as an empty map, and that falls out of this contract
 * without a second empty-map representation.
 */
export function collectionEntries(value: ValueGroup | undefined): readonly CollectionEntry[] {
  return isCollection(value) ? value.entries : [];
}

/**
 * Find a map entry by KEY IDENTITY in an already-owned entry list.
 *
 * Sass map keys use SASS EQUALITY — quoting does not distinguish `"a"` from `a`,
 * but a unit does distinguish `1px` from `1` — so this names that primitive
 * outright instead of defaulting a mode nobody at the call sites ever passed.
 */
export function collectionEntryIndex(entries: readonly CollectionEntry[], key: ValueGroup): number {
  for (let index = 0; index < entries.length; index += 1) {
    if (compare(SASS_EQUAL, entries[index]!.key, key)) {
      return index;
    }
  }
  return -1;
}

/**
 * The index of the entry whose key equals `key`, or `-1`.
 *
 * Every map operation is built from this one primitive: `get` reads the entry,
 * `has-key` tests the sign, `set` replaces in place (preserving order) or appends,
 * `remove` splices. Sass compares map keys with Sass equality, so quoting does not
 * distinguish `"a"` from `a`.
 */
export function collectionKeyIndex(value: ValueGroup | undefined, key: ValueGroup): number {
  return collectionEntryIndex(collectionEntries(value), key);
}
