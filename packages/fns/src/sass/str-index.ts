/**
 * Sass str-index() function (deprecated, use string.index() instead)
 *
 * Returns the index of the first occurrence of a substring (1-based), or null if not found.
 *
 * @example
 * str-index("Hello", "ll") // 3
 * str-index("Hello", "x") // null
 */
import { defineFunction, Quoted, Dimension } from '@jesscss/core';

const strIndex = defineFunction(
  'str-index',
  function(string: Quoted, substring: Quoted): Dimension | null {
    const strValue = String(typeof string.value === 'string' ? string.value : string.valueOf());
    const subValue = String(typeof substring.value === 'string' ? substring.value : substring.valueOf());

    const index = strValue.indexOf(subValue);
    if (index === -1) {
      return null;
    }

    // Convert to 1-based index
    // Note: Sass uses code point indexing, but for simplicity we use character indexing
    return new Dimension({ number: index + 1, unit: undefined });
  },
  {
    params: [
      {
        name: 'string',
        type: Quoted
      },
      {
        name: 'substring',
        type: Quoted
      }
    ]
  }
);

export default strIndex;
