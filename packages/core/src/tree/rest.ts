import { defineType, Node } from './node'
import { type Reference } from './reference'

/**
 * A rest expression (e.g. ...$var). By itself it doesn't do much.
 * It's used by lists to merge values. Sequences already bubble
 * lists, so this is mostly for serialization.
 */
export class Rest extends Node<Reference> {
  toTrimmedString(): string {
    return `...${this.value}`
  }
}

export const rest = defineType(Rest, 'Rest')