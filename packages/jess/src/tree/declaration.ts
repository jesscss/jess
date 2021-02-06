import { Node, LocationInfo, NodeMap } from './node'
import { Anonymous } from './anonymous'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

export type DeclarationValue = NodeMap & {
  name: Node | string
  value: any
}

/**
 * A continuous collection of nodes
 */
export class Declaration extends Node {
  name: Node
  value: any
  important: Anonymous

  constructor(
    value: DeclarationValue,
    location?: LocationInfo
  ) {
    const name = value.name
    if (name.constructor === String) {
      value.name = new Anonymous(name)
    }
    super(value, location)
  }

  eval(context: Context) {
    const node = this.clone()
    node.name = this.name.eval(context)
    node.value = context.cast(this.value).eval(context)
    if (node.important) {
      node.important = new Anonymous(this.important.value)
    }
    return node
  }

  toCSS(context: Context, out: OutputCollector) {
    this.name.toCSS(context, out)
    out.add(': ')
    context.cast(this.value).toCSS(context, out)
    if (this.important) {
      out.add(' ')
      this.important.toCSS(context, out)
    }
    out.add(';')
  }

  toModule(context: Context, out: OutputCollector) {
    let pre = context.pre
    const loc = this.location
    out.add(`$J.decl({\n`, loc)
    context.indent++
    out.add(`  ${pre}name: `)
    this.name.toModule(context, out)
    out.add(`,\n  ${pre}value: `)
    this.value.toModule(context, out)
    if (this.important) {
      out.add(`,\n  ${pre}important: `)
      this.important.toModule(context, out)
    }
    context.indent--
    out.add(`\n${pre}})`)
  }
}
Declaration.prototype.allowRuleRoot = true
Declaration.prototype.type = 'Declaration'

export const decl =
  (value: DeclarationValue, location?: LocationInfo) =>
    new Declaration(value, location)