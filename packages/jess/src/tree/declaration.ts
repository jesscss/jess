import { Node, Anonymous } from '.'
import type { LocationInfo, NodeMap } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

export type DeclarationValue = NodeMap & {
  name: Node | string
  value: Node
}

/**
 * A continuous collection of nodes
 */
export class Declaration extends Node {
  name: Node
  value: Node
  important: Node

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

  toCSS(context: Context, out: OutputCollector) {
    this.name.toCSS(context, out)
    out.add(': ')
    this.value.toCSS(context, out)
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

export const decl =
  (value: DeclarationValue, location?: LocationInfo) =>
    new Declaration(value, location)