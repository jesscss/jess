import {
  Node, defineType
} from './node'
import { type SelectorSequence } from './selector-sequence'
import { type Extend } from './extend'
import { type Context } from '../context'

/** Constructs */
export class SelectorList extends Node<Array<SelectorSequence | Extend>> {
  toTrimmedString() {
    return this.value.map(v => v.toString()).join(',')
  }

  async eval(context: Context): Promise<SelectorList | SelectorSequence | Extend> {
    return await this.evalIfNot(context, async () => {
      const list = await (super.eval(context) as Promise<SelectorList>)
      const { value } = list
      if (value.length === 1) {
        return value[0]!
      }
      return list
    })
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist')