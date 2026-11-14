/**
 * The `sass:map` members that are also reachable as deprecated GLOBAL
 * functions, under their global names.
 *
 * Every global spelling is the module member name with a `map-` prefix, and a
 * registry keys on `fn.name`, so each global gets its own callable that hands
 * its arguments to the module member — no logic is duplicated and no name is
 * overloaded. This is the same shape as `sass/string/globals.ts`.
 *
 * `map.set` and the `map.deep-*` members have no global spelling and are
 * deliberately absent.
 */
import { defineFunction } from '@jesscss/core/value';
import get from './get.js';
import hasKey from './has-key.js';
import keys from './keys.js';
import merge from './merge.js';
import remove from './remove.js';
import values from './values.js';

/** `map-get($map, $key, $keys...)` — the global spelling of `map.get()`. */
export const mapGet = defineFunction('map-get', {
  params: get.params,
  variadic: true,
  body: (args, ctx) => get(args, ctx)
});

/** `map-has-key($map, $key, $keys...)` — the global spelling of `map.has-key()`. */
export const mapHasKey = defineFunction('map-has-key', {
  params: hasKey.params,
  variadic: true,
  body: (args, ctx) => hasKey(args, ctx)
});

/** `map-keys($map)` — the global spelling of `map.keys()`. */
export const mapKeys = defineFunction('map-keys', {
  params: keys.params,
  variadic: true,
  body: (args, ctx) => keys(args, ctx)
});

/** `map-values($map)` — the global spelling of `map.values()`. */
export const mapValues = defineFunction('map-values', {
  params: values.params,
  variadic: true,
  body: (args, ctx) => values(args, ctx)
});

/** `map-merge($map1, $map2)` — the global spelling of `map.merge()`. */
export const mapMerge = defineFunction('map-merge', {
  params: merge.params,
  variadic: true,
  body: (args, ctx) => merge(args, ctx)
});

/** `map-remove($map, $keys...)` — the global spelling of `map.remove()`. */
export const mapRemove = defineFunction('map-remove', {
  params: remove.params,
  variadic: true,
  body: (args, ctx) => remove(args, ctx)
});
