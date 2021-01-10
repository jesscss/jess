import { Node } from '.'
import type { ILocationInfo } from './node'
import type { Context } from '../context' 

/**
 * A JS expression
 * (compile-time node)
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

  toModule(context?: Context) {
    return `J.cast(${this.value})`
  }
}

export const js =
  (value: string, location?: ILocationInfo) =>
    new JsExpr(value, location)