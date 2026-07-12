/**
 * Sass list.zip() function
 *
 * Combines multiple lists into a single list of lists.
 *
 * @example
 * zip(1px 2px, 3px 4px) // (1px 3px) (2px 4px)
 */
import { defineFunction, List } from '@jesscss/core';

const zip = defineFunction(
  'zip',
  function(...lists: List[]): List {
    if (lists.length === 0) {
      return new List([], { sep: ',' });
    }

    // Find the maximum length
    const maxLength = Math.max(...lists.map(l => l.length));

    // Zip the lists
    const zipped: List[] = [];
    for (let i = 0; i < maxLength; i++) {
      const row: any[] = [];
      for (const list of lists) {
        if (i < list.length) {
          row.push(list.data[i]);
        } else {
          // Sass behavior: stops when any list ends
          break;
        }
      }
      if (row.length > 0 && row.length === lists.length) {
        // Only add row if all lists have this index
        zipped.push(new List(row, { sep: undefined })); // Space-separated inner lists
      }
    }

    // Return as comma-separated list of space-separated lists
    return new List(zipped, { sep: ',' });
  },
  {
    params: [
      {
        name: 'lists',
        type: List,
        rest: true
      }
    ]
  }
);

export default zip;
