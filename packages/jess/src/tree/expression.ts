import { Node, Anonymous, Nil } from '.'
import { LocationInfo, isNodeMap, NodeMap } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

/**
 * A continuous collection of nodes
 */
export class Expression extends Node {
  value: Node[]

  constructor(
    value: (string | Node)[] | NodeMap,
    location?: LocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    }
    const values = value.map(v => v.constructor === String ? new Anonymous(v) : v)
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

  toModule(context: Context, out: OutputCollector) {
    const loc = this.location
    out.add(`$J.expr([`, loc)
    const length = this.value.length - 1
    this.value.forEach((n, i) => {
      n.toModule(context, out)
      if (i < length) {
        out.add(', ')
      }
    })
    out.add(`])`)
  }
}

export const expr =
  (...args: ConstructorParameters<typeof Expression>) =>
    new Expression(...args)