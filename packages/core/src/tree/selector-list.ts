/* eslint-disable @typescript-eslint/require-array-sort-compare */
import {
  defineType
} from './node'
import { type Context } from '../context'
import { type Selector } from './selector'
import { List } from './list'

// export interface SelectorList extends List<Selector> {
//   get value(): []
//   set value(v: T[])
// }

/** Constructs */
export class SelectorList extends List<Selector> {
  /** @todo - put in whitespace and line breaks */
  toTrimmedString(depth: number = 0) {
    let space = ''.padStart(depth * 2)
    return this.value.map(v => v.toString(depth)).join(`,\n${space}`)
  }

  valueOf() {
    return `[${this.value.map(v => v.valueOf()).sort().join(',')}]`
  }

  async eval(context: Context): Promise<SelectorList | Selector> {
    return await this.evalIfNot<SelectorList | Selector>(context, async () => {
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