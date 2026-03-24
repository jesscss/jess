/**
 * Sass list.is-bracketed() function
 *
 * Returns whether a list is bracketed.
 *
 * @example
 * is-bracketed([1, 2, 3]) // true
 * is-bracketed(1, 2, 3) // false
 */
import { defineFunction, Node, Bool } from '@jesscss/core';
import { isBracketedList } from '@jesscss/core/tree/util/list-like';

const isBracketed = defineFunction(
  'is-bracketed',
  function(list: Node): Bool {
    return new Bool(isBracketedList(list));
  },
  {
    params: [
      {
        name: 'list',
        type: Node
      }
    ]
  }
);

export default isBracketed;
