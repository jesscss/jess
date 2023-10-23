import { Node, defineType } from './node'
import type { Extend } from './extend'

/**
 * An extend statement list with no rules
 *
 * e.g.
 *  .a:extend(.b), .c:extend(.d);
 */
export class ExtendList extends Node<Extend[]> {
  toTrimmedString(depth?: number | undefined): string {
    const output = super.toTrimmedString(depth)
    return output + ';'
  }
}
ExtendList.prototype.allowRuleRoot = true
ExtendList.prototype.allowRoot = true

export const extendList = defineType(ExtendList, 'ExtendList')