import { Node, Str } from '.'
import type { ILocationInfo, NodeMap } from './node'

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

  toModule() {
    return `J.decl({ name: ${this.name.toModule()}, value: ${this.value.toModule() }})`
  }
}

export const decl =
  (value: DeclarationValue, location?: ILocationInfo) =>
    new Declaration(value, location)