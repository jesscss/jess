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
import { defineFunction, Node, Quoted, Bool } from '@jesscss/core';
import { createSassListResult, getSassListInfo, resolveSassBracketed, resolveSassSeparator } from './util.js';

const join = defineFunction(
  'join',
  function(list1: Node, list2: Node, separator?: Quoted, bracketed?: Bool | Quoted): Node {
    const left = getSassListInfo(list1);
    const right = getSassListInfo(list2);
    const sep = resolveSassSeparator(separator, left.sep ?? right.sep);
    const isBracketed = resolveSassBracketed(bracketed, left.bracketed);
    return createSassListResult([...left.items, ...right.items], sep, isBracketed);
  },
  {
    params: [
      {
        name: 'list1',
        type: Node
      },
      {
        name: 'list2',
        type: Node
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
