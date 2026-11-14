/**
 * Sass map.keys() function
 *
 * Returns a list of all keys in a map.
 *
 * @example
 * map.keys((a: 1, b: 2)) // a, b
 */
import { makeList, define, checkCollection } from '@jesscss/core/value';

const keys = define(
  'keys',
  {
    params: [{ name: 'map', type: 'Collection', check: checkCollection }] as const,
    body: map => makeList(map.entries.map(entry => entry.key), ',')
  }
);

export default keys;
