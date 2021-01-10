import { Node } from '.'
import type { NodeMap, ILocationInfo, Primitive } from './node'
import type { Context } from '../context'

/**
 * A list of expressions
 * 
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 */
export class List extends Node {
  value: Primitive[]
  
  toString() {
    return this.value.join(', ')
  }

  toModule(context: Context) {
    let out = `J.list([\n`
    context.indent++
    let pre = context.pre
    out += this.value.map(node => 
      node instanceof Node ?
        `${pre}${node.toModule(context)}` :
        `${pre}${JSON.stringify(node)}`
    ).join(',\n')
    context.indent--
    pre = context.pre
    out += `\n${pre}])`
    return out
  }
}

export const list =
  (value: Primitive[] | NodeMap, location?: ILocationInfo) =>
    new List(value, location)