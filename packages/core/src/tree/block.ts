import { Node, defineType } from './node'

export type BlockOptions = {
  type: 'curly' | 'square'
}

/**
 * A block like `{ ... }` or `[ ... ]`. This is used
 * for things like custom properties and unknown at-rules.
 */
export class Block extends Node<Node, BlockOptions> {
  declare value: Node
  type = 'Block' as const
  shortType = 'block' as const

  override toTrimmedString() {
    let { type } = this.options ?? {}
    let output = super.toTrimmedString()
    let start = type === 'square' ? '[' : '{'
    let end = type === 'square' ? ']' : '}'
    return `${start}${output}${end}`
  }
}

type BlockParams = ConstructorParameters<typeof Block>

export const block = defineType(Block, 'Block') as (
  value: BlockParams[0],
  options?: BlockParams[1],
  location?: BlockParams[2],
  treeContext?: BlockParams[3]
) => Block