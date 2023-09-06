import type { LocationInfo, Node, NodeMap } from './node'
import { isNodeMap } from './node'
import { Sequence } from './sequence'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * A space-separated sequence of nodes,
 * which is how most CSS values are written.
 *
 * @todo - Remove?
 */
export class Spaced extends Sequence {
  value: Node[]

  toModule(context: Context, out: OutputCollector) {
    const loc = this.location
    out.add('$J.spaced([', loc)
    const length = this.value.length - 1
    this.value.forEach((n, i) => {
      if (i % 2 === 0) {
        n.toModule(context, out)
        if (i < length) {
          out.add(', ', loc)
        }
      }
    })
    out.add('])')
  }
}
Spaced.prototype.type = 'Spaced'

export const spaced =
  (...args: ConstructorParameters<typeof Spaced>) =>
    new Spaced(...args)