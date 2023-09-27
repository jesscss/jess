import { Node } from '../node'
import { Nil } from '../nil'
import { List } from '../list'
import { Dimension } from '../dimension'
import { Anonymous } from '../anonymous'
import { Color } from '../color'
import { Func } from '../function'
import isPlainObject from 'lodash-es/isPlainObject'

function getNodeType(value: any): Node {
  if (value instanceof Node) {
    return value
  }
  if (value === undefined || value === null) {
    return new Nil()
  }
  if (value.constructor === Function) {
    return new Func(value)
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
    return new List(value.map(val => cast(val)))
  }
  if (value.constructor === Number) {
    return new Dimension([value as number])
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) {
      return new Color(value)
    } else {
      let result = value.match(/^(\d*(?:\.\d+))([a-z]*)$/i)
      if (result) {
        return new Dimension([parseFloat(result[1]), result[2] || undefined])
      }
    }
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