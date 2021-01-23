import { Node, Nil, Anonymous, Dimension, List, Ruleset, Declaration } from '.'
import type { LocationInfo } from './node'
import type { Context } from '../context'
import isPlainObject from 'lodash/isPlainObject'

/**
 * Casts the result of a JS expression
 * to a Jess node (if not already)
 * 
 * @example
 * cast(area(5))
 */
export class Cast extends Node {
  value: any

  cast(value: any): Node {
    if (value === undefined || value === null) {
      return new Nil
    }
    if (value instanceof Node) {
      return value
    }
    if (Array.isArray(value)) {
      return new List(value)
    }
    if (value.constructor === Number) {
      return new Dimension(<number>value)
    }
    return new Anonymous(value)
  }

  eval(context: Context) {
    const value = this.value
    if (isPlainObject(value)) {
      const rules: Node[] = []
      for (let name in value) {
        rules.push(new Declaration({ name, value: this.cast(value[name]) }))
      }
      return new Ruleset(rules)
    }
    return this.cast(value).eval(context)
  }

  toModule() { return '' }
}

export const cast =
  (value: any, location?: LocationInfo) =>
    new Cast(value, location)