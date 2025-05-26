import { Node, defineType } from './node'

export class Bool extends Node<boolean> {
  type = 'Bool' as const
  shortType = 'bool' as const

  override toTrimmedString() {
    return this.value ? 'true' : 'false'
  }
}
export const bool = defineType(Bool, 'Bool')