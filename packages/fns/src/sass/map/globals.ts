/**
 * The `sass:map` members that are also reachable as deprecated GLOBAL
 * functions, under their global names.
 *
 * Every global spelling is the module member name with a `map-` prefix, and a
 * registry keys on `fn.name`, so each global gets its own callable that
 * delegates to the single body in the module file — no logic is duplicated and
 * no name is overloaded. This is the same shape as `sass/string/globals.ts`.
 *
 * `map.set` and the `map.deep-*` members have no global spelling and are
 * deliberately absent.
 */
import { defineFunction } from '@jesscss/core';
import get from './get.js';
import hasKey from './has-key.js';
import keys from './keys.js';
import merge from './merge.js';
import remove from './remove.js';
import values from './values.js';

/** `map-get($map, $key, $keys...)` — the global spelling of `map.get()`. */
export const mapGet = defineFunction('map-get', {
  params: get.params,
  body: (map, key, rest) => get(map, key, ...rest)
});

/** `map-has-key($map, $key, $keys...)` — the global spelling of `map.has-key()`. */
export const mapHasKey = defineFunction('map-has-key', {
  params: hasKey.params,
  body: (map, key, rest) => hasKey(map, key, ...rest)
});

/** `map-keys($map)` — the global spelling of `map.keys()`. */
export const mapKeys = defineFunction('map-keys', {
  params: keys.params,
  body: map => keys(map)
});

/** `map-values($map)` — the global spelling of `map.values()`. */
export const mapValues = defineFunction('map-values', {
  params: values.params,
  body: map => values(map)
});

/** `map-merge($map1, $map2)` — the global spelling of `map.merge()`. */
export const mapMerge = defineFunction('map-merge', {
  params: merge.params,
  body: (map1, map2) => merge(map1, map2)
});

/** `map-remove($map, $keys...)` — the global spelling of `map.remove()`. */
export const mapRemove = defineFunction('map-remove', {
  params: remove.params,
  body: (map, rest) => remove(map, ...rest)
});
