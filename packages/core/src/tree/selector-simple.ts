import { type NodeValueObject } from './node'
import { Selector } from './selector'

type SimpleSelectorValue = string | NodeValueObject

export abstract class SimpleSelector<T extends SimpleSelectorValue = SimpleSelectorValue> extends Selector<T> {
  get keySet(): Set<string> {
    return (this._keySet ??= new Set([this.valueOf()]))
  }

  // find(needle: Selector): Selector[] | undefined {
  //   if (needle.keySet.isDisjointFrom(this.keySet)) {
  //     return
  //   }

  //   return this === needle ? [this] : undefined
  // }
}
