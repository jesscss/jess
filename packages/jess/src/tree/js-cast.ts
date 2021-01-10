import { Node, Nil, Str, Dimension, Expression } from '.'
import type { ILocationInfo } from './node'
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

  eval() {
    const value = this.value
    if (value === undefined || value === null) {
      return new Nil
    }
    if (value instanceof Node) {
      return value
    }
    if (Array.isArray(value)) {
      return new Expression(value)
    }
    if (value.constructor === Number) {
      return new Dimension(<number>value)
    }
    return new Str(value)
  }

  toModule() { return '' }
}

export const cast =
  (value: string, location?: ILocationInfo) =>
    new Cast(value, location)