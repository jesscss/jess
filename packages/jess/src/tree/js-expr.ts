import { Node, LocationInfo } from './node'
import { Declaration } from './declaration'
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
  post: string

  getValue() {
    const { value, post } = this
    if (post) {
      return `${value} + '${post}'`
    }
    return value
  }

  getVar(context: Context) {
    context.rootRules.push(new Declaration({
      name: context.getVar(),
      value: this
    }))
  }

  toCSS(context: Context, out: OutputCollector) {
    out.add('[[JS]]', this.location)
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(this.getValue(), this.location)
  }
}
JsExpr.prototype.type = 'JsExpr'

export const js =
  (value: string, location?: LocationInfo) =>
    new JsExpr(value, location)