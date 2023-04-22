import { LocationInfo, Node, NodeMap, isNodeMap } from './node'
import { Expression } from './expression'
import { WS } from './ws'
import type { Context } from '../context'
import { OutputCollector } from '../output'

/**
 * A space-separated expression.
 * This is basically API sugar for expressions
 */
export class Spaced extends Expression {
  value: Node[]

  constructor(
    value: (string | Node)[] | NodeMap,
    location?: LocationInfo  
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    }
    const values = [value[0]]
    for (let i = 1; i < value.length; i++) {
      values.push(
        new WS(),
        value[i]
      )
    }
    super(values, location)
  }

  toModule(context: Context, out: OutputCollector) {
    const loc = this.location
    out.add(`$J.spaced([`, loc)
    const length = this.value.length - 1
    this.value.forEach((n, i) => {
      if (i % 2 === 0) {
        n.toModule(context, out)
        if (i < length) {
          out.add(', ', loc)
        }
      }
    })
    out.add(`])`)
  }
}
Spaced.prototype.type = 'Spaced'

export const spaced =
  (...args: ConstructorParameters<typeof Spaced>) =>
    new Spaced(...args)