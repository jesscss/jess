import { type Context } from '../context'
import { type Node } from './node'
import { Selector } from './selector'

type SimpleSelectorValue = {
  value: string
}

export abstract class SimpleSelector<T extends SimpleSelectorValue = SimpleSelectorValue> extends Selector<T> {
  declare value: string

  async eval(context: Context): Promise<Node> {
    return this
  }
}