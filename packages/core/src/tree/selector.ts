import { Node } from './node'
import { Tuple, type tuple } from '@bloomberg/record-tuple-polyfill'
import { isNode } from './util'
import { type SelectorList } from './selector-list'
import { type SelectorSequence } from './selector-sequence'

const { isTuple } = Tuple

export abstract class Selector<T = any> extends Node<T> {
  /**
   * Turn everything into a normalized tuple,
   * including selector lists.
   */
  toPrimitiveSelector(): tuple | string {
    return this.toTrimmedString()
  }

  /**
   * Always creates a 3-layer tuple
   *  1. simple selectors are strings
   *  2. compound selectors are tuples
   *  3. sequences (complex selectors) are tuples of compound selectors
   *     and combinators (strings)
   *  4. lists are tuples of sequences
   *
   * @todo - it's possible we'll have to rethink this when working out :extend
   */
  toNormalizedSelector(): tuple {
    if (isNode(this, 'SelectorList')) {
      return (this as SelectorList).toPrimitiveSelector()
    }
    if (isNode(this, 'SelectorSequence')) {
      return Tuple((this as SelectorSequence).toPrimitiveSelector())
    }
    /** Create a 3-layer tuple from a simple selector */
    return Tuple(Tuple(Tuple(this.toPrimitiveSelector())))
  }

  compare(other: Node): 0 | 1 | -1 | undefined {

  }
}