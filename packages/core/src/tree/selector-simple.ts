import { type NodeValueObject, defineType } from './node'
import { Selector } from './selector'

type SimpleSelectorValue = string | NodeValueObject

export abstract class SimpleSelector<T extends SimpleSelectorValue = SimpleSelectorValue> extends Selector<T> {
  get keySet(): Set<string> {
    return (this._keySet ??= new Set([this.valueOf()]))
  }
}

defineType(SimpleSelector, 'SimpleSelector')