import { Node } from './node'
import type { tuple } from '@bloomberg/record-tuple-polyfill'

export abstract class Selector<T = any> extends Node<T> {
  toNormalizedSelector(): string | tuple {
    return this.toTrimmedString()
  }

  compare(other: Node): 0 | 1 | -1 | undefined {

  }
}