import { Node, defineType } from './node'
// import type { OutputCollector } from '../output'
import type { SelectorSequence } from './selector-sequence'
import type { SelectorList } from './selector-list'
import type { Nil } from './nil'

/**
 * An extend statement list with no rules
 *
 * e.g.
 *  .a:extend(.b), .c:extend(.d);
 */
export class ExtendList extends Node<SelectorList | SelectorSequence | Nil> {
  toTrimmedString(depth?: number | undefined): string {
    const output = super.toTrimmedString(depth)
    return output + ';'
  }
}
ExtendList.prototype.allowRuleRoot = true
ExtendList.prototype.allowRoot = true

export const extendList = defineType(ExtendList, 'ExtendList')