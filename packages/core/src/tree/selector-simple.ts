import { type Context } from '../context'
import { Node } from './node'
import type { Selector } from './selector'

type SimpleSelectorValue = {
  value: string | Node
}

export abstract class SimpleSelector<T extends SimpleSelectorValue = SimpleSelectorValue> extends Node<T> implements Selector {
  declare isSelector: true
  declare valueOf: () => string

  /** The cached key value */
  _value: string | undefined

  async eval(context: Context): Promise<Node> {
    return this
  }
}

SimpleSelector.prototype.isSelector = true
