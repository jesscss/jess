import { type Context } from '../context'
import { Node, type NodeValueObject } from './node'
import type { Selector } from './selector'

type SimpleSelectorValue = string | NodeValueObject

type NarrowType<T> =
  T extends string
    ? string
    : T extends NodeValueObject
      ? T
      : never

export abstract class SimpleSelector<T extends SimpleSelectorValue = SimpleSelectorValue> extends Node<NarrowType<T>> implements Selector {
  declare _isSelector: true
  _valueOf: string | undefined

  abstract valueOf(): string

  _keySet: Set<string> | undefined
  get keySet(): Set<string> {
    return (this._keySet ??= new Set([this.valueOf()]))
  }

  find(needle: Selector): Selector[] | undefined {
    if (needle.keySet.isDisjointFrom(this.keySet)) {
      return
    }

    return this === needle ? [this] : undefined
  }

  /**
   * We shouldn't need to clone when eval-ing in simple cases
   * but we override in complex cases.
   */
  async eval(context: Context): Promise<Node> {
    this.evaluated = true
    return this
  }
}

SimpleSelector.prototype._isSelector = true
