import { type NodeOptions, type NodeValueObject, defineType } from './node'
import { Selector } from './selector'

type SimpleSelectorValue = string | NodeValueObject

export abstract class SimpleSelector<
T extends SimpleSelectorValue = SimpleSelectorValue,
O extends NodeOptions = NodeOptions
> extends Selector<T, O> {
  get keySet(): Set<string> {
    return (this._keySet ??= new Set([this.valueOf()]))
  }
}

defineType(SimpleSelector, 'SimpleSelector')