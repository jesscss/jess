import { Node, Nil, Anonymous, Dimension, List, Ruleset, Declaration } from '.'
import type { LocationInfo } from './node'
import type { Context } from '../context'
import isPlainObject from 'lodash/isPlainObject'
import type { OutputCollector } from '../output'

/**
 * Casts the result of a JS expression
 * to a Jess node (if not already)
 * 
 * @example
 * cast(area(5))
 */
export class Cast extends Node {
  value: any

  constructor(
    value: any,
    location?: LocationInfo
  ) {
    /** 
     * Objects passed to super are assumed to be
     * Node maps, so we'll assign this manually
     */
    super({ value }, location)
  }

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
    /** Pass through objects, we'll deal with them later */
    if (isPlainObject(value)) {
      return value
    }
    return this.cast(value).eval(context)
  }

  toCSS(context: Context, out: OutputCollector) {
    const value = this.value
    if (value !== undefined) {
      if (value instanceof Node) {
        value.toCSS(context, out)
      } else {
        out.add(value.toString())
      }
    }
  }

  toModule() { return '' }
}

export const cast =
  (value: any, location?: LocationInfo) =>
    new Cast(value, location)