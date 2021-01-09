import { Node, Str } from '.'
import { ILocationInfo, isNodeMap, NodeMap } from './node'
import type { Context } from '../context'

/**
 * A continuous collection of nodes
 */
export class Expression extends Node {
  value: Node[]

  constructor(
    value: (string | Node)[] | NodeMap,
    location?: ILocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    }
    const values = value.map(v => v.constructor === String ? new Str(v) : v)
    super({
      value: values
    }, location)
  }

  toModule(context?: Context) {
    const nodes = this.value.map(node => node.toModule(context))
    return `J.expr([${nodes.join(', ')}])`
  }
}

export const expr =
  (...args: ConstructorParameters<typeof Expression>) =>
    new Expression(...args)