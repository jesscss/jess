import { Node, Str, Nil } from '.'
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

  eval(context: Context): Node {
    const node = <Expression>super.eval(context)
    node.value = node.value.filter(n => n && !(n instanceof Nil))
    if (node.value.length === 1) {
      return node.value[0]
    }
    return node
  }

  toModule(context?: Context) {
    const nodes = this.value.map(node => node.toModule(context))
    return `J.expr([${nodes.join(', ')}])`
  }
}

export const expr =
  (...args: ConstructorParameters<typeof Expression>) =>
    new Expression(...args)