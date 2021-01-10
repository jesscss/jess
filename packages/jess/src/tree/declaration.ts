import { Node, Str } from '.'
import type { ILocationInfo, NodeMap } from './node'
import type { Context } from '../context'

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

  toString() {
    return `${this.name}: ${this.value};`
  }

  toCSS(context: Context) {
    return `${context.pre}${this.toString()}`
  }

  toModule(context: Context) {
    let pre = context.pre
    let out = `J.decl({\n`
    out += `  ${pre}name: ${this.name.toModule(context)}\n`
    out += `  ${pre}value: ${this.value.toModule(context)}\n`
    out += `${pre}})`
    return out
  }
}

export const decl =
  (value: DeclarationValue, location?: ILocationInfo) =>
    new Declaration(value, location)