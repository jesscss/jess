/* eslint-disable @typescript-eslint/require-array-sort-compare */
import {
  defineType,
  type NodeData
} from './node'
import { type Context } from '../context'
import { Selector } from './selector'

/** Constructs */
export class SelectorList extends Selector<Selector[]> {
  declare value: Selector[]
  declare data: NodeData<Selector[]>
  type = 'SelectorList'
  shortType = 'sellist'

  find(needle: Selector): Selector[] | undefined {
    throw new Error('Method not implemented.')
  }

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
    const list = await (super.evalNode(context) as Promise<SelectorList>)
    const { value } = list
    if (value.length === 1) {
      return value[0]!
    }
    return list
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist')