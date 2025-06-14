import { defineType, Node } from './node'
import { isNode } from './util/is-node'

/**
 * A rest expression (e.g. ...$var). By itself it doesn't do much.
 * It's used by lists to merge values. Sequences already bubble
 * lists / sequences, so this is mostly for serialization.
 */
export class Rest extends Node<Node | string | undefined> {
  type = 'Rest' as const
  shortType = 'rest' as const

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

  override toTrimmedString(): string {
    let { name } = this
    return `...$${name}`
  }
}

export const rest = defineType(Rest, 'Rest')