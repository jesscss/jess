/* eslint-disable @typescript-eslint/require-array-sort-compare */
import {
  defineType,
  type Node
} from './node'
import type { Context } from '../context'
import { Nil } from './nil'
import { isNode } from './util'
import { Selector } from './selector'
import { Tuple, type tuple } from '@bloomberg/record-tuple-polyfill'

type SelectorValue = [Selector, Selector, ...Selector[]]
/**
 * @example
 * .class#id
 *
 * Must have at least 2 selectors. Otherwise it would be collapsed.
 */
export class CompoundSelector extends Selector<SelectorValue> {
  /**
   */
  toNormalPrimitive() {
    const list: Array<string | tuple> = []
    for (const node of this.value) {
      const primitive = node.toNormalPrimitive()
      if (Tuple.isTuple(primitive)) {
        list.push(...primitive)
      } else {
        list.push(primitive)
      }
    }

    return Tuple.from(list.sort())
  }

  /**
   * @todo - Can we do this without Tuples?
   */
  compare(other: Node) {
    if (isNode(other, 'ComplexSelector')) {
      const result = other.compare(this)
      return result !== undefined ? (-result as 0 | 1 | -1) : undefined
    }
    if (other instanceof CompoundSelector || other instanceof Selector) {
      const firstSelector = (
        other instanceof CompoundSelector
          ? other.value[0]
          : other
      ).toNormalPrimitive()
      const thisNormal = this.toNormalPrimitive()
      if (!thisNormal.includes(firstSelector)) {
        return undefined
      }
      const otherNormal = other instanceof CompoundSelector
        ? other.toNormalPrimitive()
        : Tuple([other.toNormalPrimitive()])

      if (thisNormal === otherNormal) {
        return 0
      }

      const thisBucket = [...thisNormal]
      const otherLength = otherNormal.length
      /** Find partial matches */
      for (let i = 0; i < otherLength; i++) {
        const otherEl = otherNormal[i]!
        const index = thisBucket.indexOf(otherEl)
        if (index === -1) {
          /** Not a complete partial match */
          return undefined
        }
        thisBucket.splice(index, 1)
      }
      /** Partial match */
      return -1
    }
    return super.compare(other)
  }

  async eval(context: Context): Promise<CompoundSelector | Selector | Nil> {
    return await this.evalIfNot(context, async () => {
      const sel = this.clone()
      let valuePromises = sel.value
        .map(async n => await n.eval(context))

      const returnVal = (
        (await Promise.all(valuePromises)).filter(n => n && !(n instanceof Nil))
      )
      if (returnVal.length === 0) {
        return (new Nil()).inherit(this)
      }
      if (returnVal.length === 1) {
        return returnVal[0]!.inherit(this) as Selector
      }

      sel.value = returnVal as SelectorValue

      return sel
    })
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.value.forEach(node => node.toCSS(context, out))
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.sel([', this.location)
  //   const length = this.value.length - 1
  //   this.value.forEach((node, i) => {
  //     node.toModule(context, out)
  //     if (i < length) {
  //       out.add(', ')
  //     }
  //   })
  //   out.add('])')
  // }
}

export const compound = defineType(CompoundSelector, 'CompoundSelector', 'compound')