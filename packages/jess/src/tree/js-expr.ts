import { Node } from '.'
import type { LocationInfo } from './node'
import type { Context } from '../context' 
import { OutputCollector } from '../output'

/**
 * A JS expression
 * (compile-time node)
 * 
 * @example
 * $variable
 * $(func(arg1, arg2))
 */
export class JsExpr extends Node {
  value: string

  toCSS(context: Context, out: OutputCollector) {
    out.add('[[JS]]', this.location)
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(this.value, this.location)
  }
}

export const js =
  (value: string, location?: LocationInfo) =>
    new JsExpr(value, location)