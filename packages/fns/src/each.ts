import { tree } from 'jess'
import forEach from 'lodash/forEach'

export const each = function (list: tree.List | tree.Expression | unknown, mixin: Function) {
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