/**
 * Sass map.values() function
 *
 * Returns a list of all values in a map.
 *
 * @example
 * map.values((a: 1, b: 2)) // 1, 2
 */
import { defineFunction, makeList } from '@jesscss/core';

const values = defineFunction(
  'values',
  {
    params: [{ name: 'map', type: 'Collection' }] as const,
    body: map => makeList(map.entries.map(entry => entry.value), ',')
  }
);

export default values;
