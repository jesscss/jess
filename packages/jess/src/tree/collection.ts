import { Declaration } from './declaration'
import { Node, NodeMap, ILocationInfo } from './node'
import type { Context } from '../context'
/**
 * Assigned to by a @let statement
 */
export class Collection extends Node {
  value: Declaration[]

  toString() {
    return `{\n` + this.value.map(node =>
      `  ${node.name}: ${node.value};`
    ).join('\n') + `}`
  }
  
  toCSS(context?: Context) {
    const pre = context.pre
    context.indent++
    let out = `{\n` + this.value.map(node => 
      `  ${pre}${node.name}: ${node.value.toCSS(context)};`
    ).join('\n') + `${pre}}`
    context.indent--
    return out
  }

  toModule(context?: Context) {
    const pre = context.pre
    context.indent++
    let out = `{\n` + this.value.map(node =>
      `  ${pre}${JSON.stringify(node.name.toString())}: ${node.value.toModule()}`
    ).join(',\n') + `${pre}}`
    context.indent--
    return out
  }
}

export const coll =
  (value: Declaration[] | NodeMap, location?: ILocationInfo) =>
    new Collection(value, location)