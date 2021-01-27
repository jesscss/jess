import { Node } from '.'
import type { NodeMap, LocationInfo, Primitive } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'
import { cast } from './util'

/**
 * A list of expressions
 * 
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 */
export class List<T extends Primitive = Primitive> extends Node {
  value: T[]
  
  toCSS(context: Context, out: OutputCollector) {
    out.add('', this.location)
    const length = this.value.length - 1
    const pre = context.pre
    this.value.forEach((node, i) => {
      const val = cast(node)
      val.toCSS(context, out)
      
      if (i < length) {
        if (context.inSelector) {
          out.add(`,\n${pre}`)
        } else {
          out.add(', ')
        }
      }
    })
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.list([\n`, this.location)
    context.indent++
    let pre = context.pre
    const length = this.value.length - 1
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
  (value: Primitive[] | NodeMap, location?: LocationInfo) =>
    new List(value, location)