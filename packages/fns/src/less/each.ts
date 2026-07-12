import {
  List,
  Node,
  Rules,
  Mixin,
  General,
  getFunctionFromMixins
} from '@jesscss/core'
import { type ExtendedFn } from '../util'
import { type, instance, union, assert } from 'superstruct'

const Struct = type({
  list: instance(Node),
  mixin: union([instance(Mixin), instance(Rules)])
})

/**
 * This is a 1-based iterator. Meaning,
 * for lists without keys, the first key is 1, not 0.
 *
 * @example
 * @-from '@jesscss/fns' import (each);
 * @-let list: 1, 2, 3;
 * @-mixin iterate (value, key) {
 *   .icon-#($value) {
 *     width: $value;
 *     height: $key;
 *   }
 * }
 * $each(list, iterate);
 */
const each: ExtendedFn = async function each(list: Node, mixin: Mixin | Rules) {
  assert({ list, mixin }, Struct)
  let entries = list.entries()
  /** If a Node is not list-like, wrap it */
  if (!entries) {
    entries = [[0, list]].entries()
  }
  if (mixin instanceof Rules) {
    mixin = new Mixin([
      ['params', new List([
        new General('value', { type: 'Name' }),
        new General('key', { type: 'Name' }),
        new General('index', { type: 'Name' })
      ])]
    ])
  }
  const func = getFunctionFromMixins(mixin).bind(this)

  const rule = new Rules([])
  const rules = rule.value

  let index = 1

  for (let [key, value] of entries) {
    let keyStr = typeof key === 'number' ? `${key + 1}` : key
    let outputRules = await func(value, keyStr, index++)
    rules.push(outputRules)
  }

  return rules
}

export default each