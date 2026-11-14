/**
 * Sass map.values() function
 *
 * Returns a list of all values in a map.
 *
 * @example
 * map.values((a: 1, b: 2)) // 1, 2
 */
import { makeList, define, checkCollection } from '@jesscss/core/value';

const values = define(
  'values',
  {
    params: [{ name: 'map', type: 'Collection', check: checkCollection }] as const,
    body: map => makeList(map.entries.map(entry => entry.value), ',')
  }
);

export default values;
