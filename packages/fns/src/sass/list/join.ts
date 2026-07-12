/**
 * Sass list.join() function
 *
 * Joins two lists together.
 *
 * @example
 * join(1 2, 3 4) // 1 2 3 4
 * join(1, 2, comma) // 1, 2
 * join([1], [2], comma, true) // [1, 2]
 */
import { defineFunction, List, Node, Quoted, Bool } from '@jesscss/core';

const join = defineFunction(
  'join',
  function(list1: List, list2: List, separator?: Quoted, bracketed?: Bool | Quoted): List {
    // Determine separator
    let sep: ',' | ';' | '/' | undefined = list1.options?.sep;

    if (separator) {
      const sepStr = separator.valueOf();
      if (sepStr === 'comma') {
        sep = ',';
      } else if (sepStr === 'slash') {
        sep = '/';
      } else if (sepStr === 'space') {
        sep = undefined; // Space is default
      } else if (sepStr === 'auto') {
        // Use first list's separator, or second's, or default to space
        sep = list1.options?.sep ?? list2.options?.sep ?? undefined;
      } else {
        throw new Error(`$separator: Must be "space", "comma", "slash", or "auto".`);
      }
    } else {
      // Auto behavior: use first list's separator, or second's, or default to space
      sep = list1.options?.sep ?? list2.options?.sep ?? undefined;
    }

    // Join the lists
    const newList = new List([...list1.value, ...list2.value], { sep });

    // Note: bracketed parameter is not yet fully supported in Jess AST
    // TODO: Handle bracketed lists when Jess AST supports it

    return newList;
  },
  {
    params: [
      {
        name: 'list1',
        type: List
      },
      {
        name: 'list2',
        type: List
      },
      {
        name: 'separator',
        type: Quoted,
        optional: true
      },
      {
        name: 'bracketed',
        type: [Bool, Quoted],
        optional: true
      }
    ]
  }
);

export default join;
