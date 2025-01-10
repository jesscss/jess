import { type Context } from '../context'
import { Node } from './node'
import type { Selector } from './selector'

type SimpleSelectorValue = {
  value: string | Node
}

export abstract class SimpleSelector<T extends SimpleSelectorValue = SimpleSelectorValue> extends Node<T> implements Selector {
  declare isSelector: true
  _valueOf: string | undefined

  abstract valueOf(): string

  _keySet: Set<string> | undefined
  get keySet(): Set<string> {
    return (this._keySet ??= new Set([this.valueOf()]))
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

SimpleSelector.prototype.isSelector = true
