import { Node } from '../node'
import { Nil } from '../nil'
import { List } from '../list'
import { Dimension } from '../dimension'
import { Anonymous } from '../anonymous'
import isPlainObject from 'lodash-es/isPlainObject'

function getNodeType(value: any): Node {
  if (value instanceof Node) {
    return value
  }
  if (value === undefined || value === null) {
    return new Nil()
  }
  /**
   * @todo - need to remove the $root part
   * as we're not compiling to a module anymore
   */
  if (isPlainObject(value)) {
    if (Object.prototype.hasOwnProperty.call(value, '$root')) {
      return value.$root
    }
    return new Anonymous('[object]')
  }
  if (Array.isArray(value)) {
    return new List(value)
  }
  if (value.constructor === Number) {
    return new Dimension([value as number])
  }
  return new Anonymous(value.toString())
}
/**
 * Casts a primitive JavaScript value to a Jess node
 * (if not already).
 *
 * @example
 * cast(area(5))
 */
export function cast(value: any): Node {
  const node = getNodeType(value)
  node.evaluated = true
  return node
}