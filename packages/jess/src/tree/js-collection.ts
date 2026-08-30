import { Node, NodeMap, LocationInfo } from './node'
import type { JsKeyValue } from './js-key-value'
import type { Context } from '../context'
import type { OutputCollector } from '../output'
/**
 * Assigned to by a @let statement
 */
export class JsCollection extends Node {
  value: JsKeyValue[]
  
  toCSS(context: Context, out: OutputCollector) {
    let pre = context.pre
    context.indent++
    out.add(`{\n`, this.location)
    const length = this.value.length
    this.value.forEach((decl, i) => {
      out.add(`${pre}  `)
      decl.toCSS(context, out)
      if (i < length) {
        out.add('\n')
      }
    })
    context.indent--
    out.add(`${pre}}`)
    return out
  }

  toModule(context: Context, out: OutputCollector) {
    const pre = context.pre
    context.indent++
    out.add(`{\n`, this.location)
    const length = this.value.length - 1
    this.value.forEach((node, i) => {
      out.add(`  ${pre}${JSON.stringify(node.name.toString())}: `)
      node.value.toModule(context, out)
      if (i < length) {
        out.add(',')
      }
      out.add('\n')
    })
    out.add(`${pre}}`)
    context.indent--
  }
}
JsCollection.prototype.type = 'JsCollection'

export const coll =
  (value: JsKeyValue[] | NodeMap, location?: LocationInfo) =>
    new JsCollection(value, location)