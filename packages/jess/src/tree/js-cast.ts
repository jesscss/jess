import { Node, Nil, Anonymous, Dimension, Expression } from '.'
import type { LocationInfo } from './node'
import type { Context } from '../context'
/**
 * Casts the result of a JS expression
 * to a Jess node (if not already)
 * 
 * @example
 * cast(area(5))
 */
export class Cast extends Node {
  value: any

  eval(context: Context) {
    const value = this.value
    if (value === undefined || value === null) {
      return new Nil
    }
    if (value instanceof Node) {
      return value.eval(context)
    }
    if (Array.isArray(value)) {
      return new Expression(value).eval(context)
    }
    if (value.constructor === Number) {
      return new Dimension(<number>value)
    }
    return new Anonymous(value)
  }

  toModule() { return '' }
}

export const cast =
  (value: any, location?: LocationInfo) =>
    new Cast(value, location)