/* eslint-disable @typescript-eslint/require-array-sort-compare */
import { Combinator } from './combinator'
import { Ampersand } from './ampersand'
import {
  defineType,
  type Node
} from './node'
import type { Context } from '../context'
import { type Nil } from './nil'
import { type SimpleSelector } from './selector-simple'
// import { BasicSelector } from './selector-basic'
import { isNode } from './util'
import { compare } from './util/compare'
import { PseudoSelector } from './selector-pseudo'
import { type SelectorList } from './selector-list'
import { Selector } from './selector'
import { Tuple, type tuple } from '@bloomberg/record-tuple-polyfill'

/**
 * @example
 * .class#id
 *
 * Must have at least 2 selectors. Otherwise it would be collapsed.
 */
export class CompoundSelector extends Selector<[Selector, Selector, ...Selector[]]> {
  /**
   */
  toNormalPrimitive() {
    return Tuple.from(
      this.value
        .map(v => v.toNormalPrimitive())
        .sort()
    )
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

  async eval(context: Context): Promise<CompoundSelector | SelectorList | Nil> {

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