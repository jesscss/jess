/**
 * Sass map.keys() function
 *
 * Returns a list of all keys in a map.
 *
 * @example
 * map.keys((a: 1, b: 2)) // a, b
 */
import { defineFunction, makeList } from '@jesscss/core/value';

const keys = defineFunction(
  'keys',
  {
    params: [{ name: 'map', kinds: ['Collection'] }] as const,
    body: map => makeList(map.entries.map(entry => entry.key), ',')
  }
);

export default keys;
