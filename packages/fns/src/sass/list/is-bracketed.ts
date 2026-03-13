/**
 * Sass list.is-bracketed() function
 *
 * Returns whether a list is bracketed.
 *
 * @example
 * is-bracketed([1, 2, 3]) // true
 * is-bracketed(1, 2, 3) // false
 */
import { defineFunction, List, Bool, Paren } from '@jesscss/core';

const isBracketed = defineFunction(
  'is-bracketed',
  function(list: List): Bool {
    // In Jess, bracketed lists might be represented as a List wrapped in a Paren
    // or we might need to check the parent. For now, check if parent is a Paren
    // Note: This is a simplified check - actual implementation may need to track
    // brackets differently in Jess's AST
    const parent = list.parent;
    // If the list is wrapped in a Paren, it might be bracketed
    // But we need to distinguish between () and [] - for now, return false
    // TODO: Implement proper bracket detection when Jess AST supports it
    return new Bool(false);
  },
  {
    params: [
      {
        name: 'list',
        type: List
      }
    ]
  }
);

export default isBracketed;
