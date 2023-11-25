import {
  Node, defineType
} from './node'
import { type SelectorSequence } from './selector-sequence'
import { type Extend } from './extend'
import { type Context } from '../context'
import { compareNodeArray } from './util/compare'

/** Constructs */
export class SelectorList<
  T extends Node = SelectorSequence | Extend
> extends Node<T[]> {
  toTrimmedString() {
    return this.value.map(v => v.toString()).join(',')
  }

  normalizedSelector() {

  }

  compare(other: Node) {
    if (other instanceof SelectorList) {
      return compareNodeArray(this.value, other.value)
    }
    return super.compare(other)
  }

  async eval(context: Context): Promise<SelectorList<T> | T> {
    return await this.evalIfNot<SelectorList<T> | T>(context, async () => {
      const list = await (super.eval(context) as Promise<SelectorList<T>>)
      const { value } = list
      if (value.length === 1) {
        return value[0]!
      }
      return list
    })
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist')