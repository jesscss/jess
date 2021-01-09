import { Node } from '.'
import type { ILocationInfo } from './node'

/**
 * A JS expression
 * 
 * @example
 * $variable
 * $[func(arg1, arg2)]
 */
export class JsExpr extends Node {
  value: string

  toString() {
    return '[[JS]]'
  }

  toModule() {
    return this.value
  }
}

export const js =
  (value: string, location?: ILocationInfo) =>
    new JsExpr(value, location)