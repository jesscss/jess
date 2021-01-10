import { Expression } from '.'
import type { Node } from './node'
import type { Context } from '../context'

/**
 * A space-separated expression
 */
export class Spaced extends Expression {
  value: Node[]
  
  toString() {
    return this.value.join(' ')
  }

  toModule(context?: Context) {
    const nodes = this.value.map(node => node.toModule(context))
    return `J.spaced([${nodes.join(', ')}])`
  }
}

export const spaced =
  (...args: ConstructorParameters<typeof Spaced>) =>
    new Spaced(...args)