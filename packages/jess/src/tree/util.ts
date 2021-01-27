import { Node, Nil, List, Dimension, Anonymous } from '.'
import isPlainObject from 'lodash/isPlainObject'

/**
 * Casts a primitive value to a Jess node
 * (if not already). This is for CSS output.
 * 
 * @example
 * cast(area(5))
 */
export const cast = (value: any): Node => {
  if (value === undefined || value === null) {
    return new Nil
  }
  if (value instanceof Node) {
    return value
  }
  if (isPlainObject(value)) {
    return new Anonymous('[object]')
  }
  if (Array.isArray(value)) {
    return new List(value)
  }
  if (value.constructor === Number) {
    return new Dimension(<number>value)
  }
  return new Anonymous(value.toString())
}
