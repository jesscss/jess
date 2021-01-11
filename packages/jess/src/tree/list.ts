import { Node } from '.'
import type { NodeMap, ILocationInfo, Primitive } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

/**
 * A list of expressions
 * 
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 */
export class List extends Node {
  value: Primitive[]
  
  toCSS(context: Context, out: OutputCollector) {
    out.add('', this.location)
    const length = this.value.length - 1
    this.value.forEach((node, i) => {
      if (node instanceof Node) {
        node.toModule(context, out)
      } else {
        out.add(node.toString())
      }
      if (i < length) {
        out.add(', ')
      }
    })
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`J.list([\n`, this.location)
    context.indent++
    let pre = context.pre
    const length = this.value.length
    this.value.forEach((node, i) => {
      out.add(pre)
      if (node instanceof Node) {
        node.toModule(context, out)
      } else {
        out.add(JSON.stringify(node))
      }
      if (i < length) {
        out.add(',\n')
      }
    })
    context.indent--
    pre = context.pre
    out.add(`\n${pre}])`)
    return out
  }
}

export const list =
  (value: Primitive[] | NodeMap, location?: ILocationInfo) =>
    new List(value, location)