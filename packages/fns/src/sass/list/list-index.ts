/**
 * Sass list.index() function
 *
 * Returns the index of a value in a list (1-based), or null if not found.
 *
 * @example
 * index(1 2 3, 2) // 2
 * index([a, b, c], d) // null
 */
import { defineFunction, List, Dimension, Node } from '@jesscss/core';

const index = defineFunction(
  'index',
  function(list: List, value: Node): Dimension | null {
    // Find the index of the value in the list
    const listValue = list.value;
    for (let i = 0; i < listValue.length; i++) {
      const item = listValue[i];
      // Compare nodes - use compare method if available
      if (item && typeof item.compare === 'function') {
        try {
          const comparison = item.compare(value);
          if (comparison === 0) {
            // Found it - return 1-based index
            return new Dimension({ number: i + 1, unit: undefined });
          }
        } catch {
          // Comparison failed, try valueOf
        }
      }
      // Fallback to valueOf comparison
      if (item?.valueOf() === value?.valueOf()) {
        return new Dimension({ number: i + 1, unit: undefined });
      }
    }
    // Not found - return null (Sass returns sassNull)
    return null;
  },
  {
    params: [
      {
        name: 'list',
        type: List
      },
      {
        name: 'value',
        type: Node
      }
    ]
  }
);

export default index;
