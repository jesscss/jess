import { defineType, Node } from './node'

export type RestValue = {
  /** In mixin params, rest can be without names */
  name?: string
  value?: Node
}
/**
 * A rest expression (e.g. ...$var). By itself it doesn't do much.
 * It's used by lists to merge values. Sequences already bubble
 * lists / sequences, so this is mostly for serialization.
 */
export class Rest extends Node<RestValue> {
  get name() {
    return this.data.get('name')
  }

  toTrimmedString(): string {
    let serialized = this.name ? `$${this.name}` : this.value
    return `...${serialized ?? ''}`
  }
}

export const rest = defineType(Rest, 'Rest')