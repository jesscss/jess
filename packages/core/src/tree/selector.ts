import { Node } from './node'
import { Tuple, type tuple } from '@bloomberg/record-tuple-polyfill'
import { isNode } from './util'
import { type SelectorList } from './selector-list'
import { type SelectorSequence } from './selector-sequence'

const { isTuple } = Tuple

/** Will be bound in ./util/compare.ts */
export interface Selector<T = any> extends Node<T> {
  compare(other: Node): 0 | 1 | -1 | undefined
}

export abstract class Selector<T = any> extends Node<T> {
  /**
   * Turn everything into a normalized string.
   */
  toNormalizedString(): string {
    return this.toTrimmedString()
  }
}