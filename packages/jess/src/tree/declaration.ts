import { Node, Str } from '.'
import type { ILocationInfo, NodeMap } from './node'
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

  constructor(
    value: DeclarationValue,
    location?: ILocationInfo
  ) {
    const name = value.name
    if (name.constructor === String) {
      value.name = new Str(name)
    }
    super(value, location)
  }

  toCSS(context: Context, out: OutputCollector) {
    const loc = this.location
    out.add(context.pre, loc)
    this.name.toCSS(context, out)
    out.add(':', loc)
    this.value.toCSS(context, out)
    out.add(';', loc)
  }

  toModule(context: Context, out: OutputCollector) {
    let pre = context.pre
    const loc = this.location
    out.add(`J.decl({\n`, loc)
    out.add(`  ${pre}name:`)
    this.name.toModule(context, out)
    out.add(`\n${pre}value:`)
    this.value.toModule(context, out)
    out.add(`\n${pre}})`)
  }
}

export const decl =
  (value: DeclarationValue, location?: ILocationInfo) =>
    new Declaration(value, location)