/* eslint-disable @typescript-eslint/require-array-sort-compare */
import {
  type Node, defineType
} from './node'
import { type ComplexSelector } from './selector-complex'
import { type Extend } from './extend'
import { type Context } from '../context'
import { compareNodeArray } from './util/compare'
import { Selector } from './selector'
import { Tuple, type tuple } from '@bloomberg/record-tuple-polyfill'

/** Constructs */
export class SelectorList<
  T extends Selector = Selector | Extend
> extends Selector<T[]> {
  toTrimmedString() {
    return this.value.map(v => v.toString()).join(',')
  }

  toNormalPrimitive(): string | tuple {
    const { value } = this
    const list = value.map(v => v.toNormalPrimitive())
    const finalList: Array<string | tuple> = []
    const valueLength = list.length
    for (let i = 0; i < valueLength; i++) {
      const selector = list[i]!
      if (Tuple.isTuple(selector)) {
        const selectorLength = selector.length
        for (let j = 0; j < selectorLength; j++) {
          const item = selector[j]!
          if (list.every(v => v[j] === item)) {
            finalList.push(item)
          }
        }
      }
    }
    return Tuple.from(list)
  }

  compare(other: Node) {
    if (other instanceof Selector) {
      const thisNormal = this.toNormalPrimitive()
      const otherNormal = other.toNormalPrimitive()
      // const getValue = (v: Node) => v instanceof Selector ? v.toNormalPrimitive() : v.toTrimmedString()
      // /** @todo - Lists may not be sortable, they should be matched and reduced */
      // return compareNodeArray(
      //   this.value.map(v => getValue(v)).sort(),
      //   other.value.map(v => getValue(v)).sort()
      // )
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