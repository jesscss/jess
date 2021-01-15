import { Anonymous, ILocationInfo, NodeMap } from '.'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

export class Combinator extends Anonymous {
  toCSS(context: Context, out: OutputCollector) {
    const val = this.value
    out.add(val === ' ' ? val : ` ${val} `, this.location)
  }
  toModule(context: Context, out: OutputCollector) {
    out.add(`_J.co("${this.value}")`)
  }
}

export const co =
  (value?: string | NodeMap, location?: ILocationInfo) =>
    new Combinator(value, location)