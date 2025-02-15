/* eslint-disable @typescript-eslint/require-array-sort-compare */
import {
  defineType
} from './node'
import { type Context } from '../context'
import { Selector } from './selector'

// export interface SelectorList extends List<Selector> {
//   get value(): []
//   set value(v: T[])
// }

/** Constructs */
export class SelectorList extends Selector<Selector[]> {
  find(needle: Selector): Selector[] | undefined {
    throw new Error('Method not implemented.')
  }

  declare _isSelector: true

  get keySet(): Set<string> {
    /** @todo - build key set */
    return (this._keySet ??= new Set())
  }

  /** @todo - put in whitespace and line breaks */
  override toTrimmedString(depth: number = 0) {
    let space = ''.padStart(depth * 2)
    return this.value.map(v => v.toString(depth)).join(`,\n${space}`)
  }

  override valueOf() {
    return this.value.map(v => v.valueOf()).sort().join(',')
  }

  override async evalNode(context: Context): Promise<SelectorList | Selector> {
    const list = await (super.eval(context) as Promise<SelectorList>)
    const { value } = list
    if (value.length === 1) {
      return value[0]!
    }
    return list
  }
}

SelectorList.prototype._isSelector = true

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist')