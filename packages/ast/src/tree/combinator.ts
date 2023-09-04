import { Node, type LocationInfo, type NodeMap } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

export class Combinator extends Node {
  value: string
  toCSS(context: Context, out: OutputCollector) {
    const val = this.value
    out.add(val === ' ' ? val : ` ${val} `, this.location)
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.co("${this.value}")`)
  }
}
Combinator.prototype.type = 'Combinator'
Combinator.prototype.shortType = 'co'

export const co =
  (value?: string | NodeMap, location?: LocationInfo) =>
    new Combinator(value, location)