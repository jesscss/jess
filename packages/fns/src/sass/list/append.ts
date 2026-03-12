/**
 * Sass list.append() function
 *
 * Appends a value to a list.
 *
 * @example
 * append(1 2, 3) // 1 2 3
 * append(1, 2, comma) // 1, 2
 */
import { defineFunction, List, Node, Quoted } from '@jesscss/core';

const append = defineFunction(
  'append',
  function(list: List, val: Node, separator?: Quoted): List {
    // Determine separator
    let sep: ',' | ';' | '/' | undefined = list.options?.sep;

    if (separator) {
      const sepStr = separator.valueOf();
      if (sepStr === 'comma') {
        sep = ',';
      } else if (sepStr === 'slash') {
        sep = '/';
      } else if (sepStr === 'space') {
        sep = undefined; // Space is default (no sep in Jess)
      } else if (sepStr === 'auto') {
        // Use list's existing separator, or space if undecided
        sep = list.options?.sep ?? undefined;
      } else {
        throw new Error(`$separator: Must be "space", "comma", "slash", or "auto".`);
      }
    }

    // Create new list with appended value
    const newList = new List([...list.data, val], { sep });
    return newList;
  },
  {
    params: [
      {
        name: 'list',
        type: List
      },
      {
        name: 'val',
        type: Node
      },
      {
        name: 'separator',
        type: Quoted,
        optional: true
      }
    ]
  }
);

export default append;
