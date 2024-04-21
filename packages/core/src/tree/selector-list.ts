/* eslint-disable @typescript-eslint/require-array-sort-compare */
import {
  defineType
} from './node'
import { type Context } from '../context'
import { Selector } from './selector'

/** Constructs */
export class SelectorList<
  T extends Selector = Selector
> extends Selector<T[]> {
  /** @todo - put in whitespace and line breaks */
  toTrimmedString(depth: number = 0) {
    let space = ''.padStart(depth * 2)
    return this.value.map(v => v.toString(depth)).join(`,\n${space}`)
  }

  valueOf() {
    return this.value.map(v => v.valueOf()).sort().join(',')
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