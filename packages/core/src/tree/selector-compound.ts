/* eslint-disable @typescript-eslint/require-array-sort-compare */
import {
  defineType
} from './node'
import type { Context } from '../context'
import { Nil } from './nil'
import { Selector } from './selector'
import type { SimpleSelector } from './selector-simple'

/**
 * @example
 * .class#id
 *
 * Must have at least 2 selectors. Otherwise it would be collapsed.
 */
const nonElementRegex = /^[.#:*[]/
export class CompoundSelector extends Selector<SimpleSelector[]> {
  declare value: SimpleSelector[]
  type = 'CompoundSelector' as const
  shortType = 'compound' as const

  get keySet() {
    /** @todo - build key set */
    return (this._keySet ??= new Set())
  }

  override valueOf() {
    let value = this._valueOf
    if (!value) {
      value = this.value
        .map(n => n.valueOf())
        .sort((a, b) => {
          /** Elements come first */
          if (!nonElementRegex.test(a)) {
            if (!nonElementRegex.test(b)) {
              return a < b ? -1 : 1
            }
            return -1
          } else if (!nonElementRegex.test(b)) {
            return 1
          }
          return a < b ? -1 : 1
        })
        .join('')
      this._valueOf = value
    }
    return value
  }

  override async evalNode(context: Context): Promise<CompoundSelector | Selector | Nil> {
    const sel = this.maybeClone(context)
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

    this.data.set('value', returnVal as SimpleSelector[])

    return sel
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