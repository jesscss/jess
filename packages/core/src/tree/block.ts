import { Node, defineType } from './node'

export type BlockOptions = {
  type: 'curly' | 'square'
}

/**
 * A block like `{ ... }` or `[ ... ]`. This is used
 * for things like custom properties and unknown at-rules.
 */
export class Block extends Node<Node, BlockOptions> {
  toTrimmedString() {
    let { type } = this.options ?? {}
    let output = super.toTrimmedString()
    let start = type === 'square' ? '[' : '{'
    let end = type === 'square' ? ']' : '}'
    return `${start}${output}${end}`
  }
}
export const block = defineType(Block, 'Block')