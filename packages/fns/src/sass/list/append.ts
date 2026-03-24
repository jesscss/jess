/**
 * Sass list.append() function
 *
 * Appends a value to a list.
 *
 * @example
 * append(1 2, 3) // 1 2 3
 * append(1, 2, comma) // 1, 2
 */
import { defineFunction, Node, Quoted } from '@jesscss/core';
import { createSassListResult, getSassListInfo, resolveSassSeparator } from './util.js';

const append = defineFunction(
  'append',
  function(list: Node, val: Node, separator?: Quoted): Node {
    const info = getSassListInfo(list);
    const sep = resolveSassSeparator(separator, info.sep);
    return createSassListResult([...info.items, val], sep, info.bracketed);
  },
  {
    params: [
      {
        name: 'list',
        type: Node
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
