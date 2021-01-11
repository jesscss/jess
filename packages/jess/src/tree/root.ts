import { Node, NodeMap, ILocationInfo, Nil } from '.'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * The root node. Contains a collection of nodes
 */
export class Root extends Node {
  value: Node[]

  eval(context: Context) {
    const node = <Root>super.eval(context)
    node.value = node.value.filter(n => n && !(n instanceof Nil))
    return node
  }

  toCSS(context: Context, output: OutputCollector) {
    this.value.forEach(v => v.toCSS(context, output))
  }

  toModule() {
    return ''
  }
}

export const root =
  (value: Node[] | NodeMap, location?: ILocationInfo) =>
    new Root(value, location)