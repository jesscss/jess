import { Node } from './node'
import { type tuple } from '@bloomberg/record-tuple-polyfill'

/** Will be bound in ./util/compare.ts */
export interface Selector<T = any> extends Node<T> {
  compare(other: Node): 0 | 1 | -1 | undefined
}

export abstract class Selector<T = any> extends Node<T> {
  /**
   * Normalize for comparison
   */
  toNormalPrimitive(): string | tuple {
    return this.toTrimmedString()
  }
}