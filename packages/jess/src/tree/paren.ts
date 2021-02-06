import { Node, NodeMap, LocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * An expression in parenthesis
 */
export class Paren extends Node {
  value: Node

  toCSS(context: Context, out: OutputCollector) {
    out.add('(')
    this.value.toCSS(context, out)
    out.add(')')
  }

  toModule(context: Context, out: OutputCollector) {
    const loc = this.location
    out.add(`$J.paren(`, loc)
    this.value.toModule(context, out)
    out.add(')')
  }
}
Paren.prototype.type = 'Paren'

export const paren =
  (value: Node | NodeMap, location?: LocationInfo) =>
    new Paren(value, location)