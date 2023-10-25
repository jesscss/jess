import { defineType, Node } from './node'
import { isNode } from './util'

/**
 * A rest expression (e.g. ...$var). By itself it doesn't do much.
 * It's used by lists to merge values. Sequences already bubble
 * lists / sequences, so this is mostly for serialization.
 */
export class Rest extends Node<Node | string | undefined> {
  get name(): string {
    let { value } = this
    if (value) {
      if (isNode(value)) {
        return value.toString()
      }
      return `$${value}`
    }
    return ''
  }

  toTrimmedString(): string {
    let { name } = this
    return `...${name}`
  }
}

export const rest = defineType(Rest, 'Rest')