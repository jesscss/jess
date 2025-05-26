import { Node, defineType } from './node'
import type { Extend } from './extend'

/**
 * An extend statement list with no rules
 *
 * e.g.
 *  .a:extend(.b), .c:extend(.d);
 */
export class ExtendList extends Node<Extend[]> {
  type = 'ExtendList' as const
  shortType = 'extendlist' as const
  override allowRoot = true
  override allowRuleRoot = true

  override toTrimmedString(depth?: number | undefined): string {
    const output = super.toTrimmedString(depth)
    return output + ';'
  }
}

export const extendList = defineType(ExtendList, 'ExtendList')