import { tree } from 'jess'
import forEach from 'lodash/forEach'

/**
 * @example
 * @import { each } from '@jesscss/fns';
 * @let list: 1, 2, 3;
 * @mixin iterate (value, key) {
 *   .icon-$(value) {
 *     width: $value;
 *     height: $key;
 *   }
 * }
 * @include $each(list, iterate);
 */

export function each(list: tree.List | tree.Expression | unknown, mixin: Function) {
  const { List, Expression, Ruleset } = tree
  let collection: any
  let rules = new Ruleset([])
  if (list instanceof List || list instanceof Expression) {
    collection = list.toArray()
  } else {
    collection = list
  }
  forEach(collection, (value, key) => {
    rules.value.push(mixin(value, key))
  })

  return rules
}