/**
 * Sass list.zip() function
 *
 * Combines multiple lists into a single list of lists.
 *
 * @example
 * zip(1px 2px, 3px 4px) // (1px 3px) (2px 4px)
 */
import { defineFunction, List, Node } from '@jesscss/core';
import { coerceListItems } from '@jesscss/core';
import { createSassListResult } from './util.js';

const zip = defineFunction(
  'zip',
  function(...lists: Node[]): List {
    if (lists.length === 0) {
      return new List([], { sep: ',' });
    }

    const itemLists = lists.map(list => coerceListItems(list));
    const maxLength = Math.max(...itemLists.map(list => list.length));

    // Zip the lists
    const zipped: List[] = [];
    for (let i = 0; i < maxLength; i++) {
      const row: Node[] = [];
      for (const list of itemLists) {
        if (i < list.length) {
          row.push(list[i]!);
        } else {
          // Sass behavior: stops when any list ends
          break;
        }
      }
      if (row.length > 0 && row.length === lists.length) {
        // Only add row if all lists have this index
        zipped.push(createSassListResult(row, undefined, false)); // Space-separated inner lists
      }
    }

    // Return as comma-separated list of space-separated lists
    return new List(zipped, { sep: ',' });
  },
  {
    params: [
      {
        name: 'lists',
        type: Node,
        rest: true
      }
    ]
  }
);

export default zip;
