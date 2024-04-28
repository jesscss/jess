import { type Context } from '../context'
import { type Node } from './node'
import { Selector } from './selector'

type SimpleSelectorValue = {
  value: string
}

export abstract class SimpleSelector<T extends SimpleSelectorValue = SimpleSelectorValue> extends Selector<T> {
  get value(): string {
    return this.data.get('value')
  }

  set value(v: string) {
    this.data.set('value', v)
  }

  async eval(context: Context): Promise<Node> {
    return this
  }
}