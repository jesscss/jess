import { Node, NodeMap, LocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * An expression in square brackets
 */
export class Square extends Node {
  value: Node

  toCSS(context: Context, out: OutputCollector) {
    out.add('[')
    this.value.toCSS(context, out)
    out.add(']')
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.square(`, this.location)
    this.value.toModule(context, out)
    out.add(')')
  }
}
Square.prototype.type = 'Square'

export const square =
  (value: Node | NodeMap, location?: LocationInfo) =>
    new Square(value, location)