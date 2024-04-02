/* eslint-disable @typescript-eslint/require-array-sort-compare */
import { Combinator } from './combinator'
import { Ampersand } from './ampersand'
import {
  defineType,
  type Node
} from './node'
import type { Context } from '../context'
import { Nil } from './nil'
import { type SimpleSelector } from './selector-simple'
// import { BasicSelector } from './selector-basic'
import { isNode } from './util'
import { compare } from './util/compare'
import { PseudoSelector } from './selector-pseudo'
import { type SelectorList } from './selector-list'
import { Selector } from './selector'
import { Tuple, type tuple } from '@bloomberg/record-tuple-polyfill'
import { type CompoundSelector } from './selector-compound'

type SelectorValue = [
  first: SimpleSelector | CompoundSelector,
  ...rest: Array<Combinator | SimpleSelector | CompoundSelector>
] | [
  first: Combinator,
  second: SimpleSelector | CompoundSelector,
  ...rest: Array<Combinator | SimpleSelector | CompoundSelector>
]
/**
 * Selectors with combinators.
 *
 * @example
 * #id > .class.class
 */
export class ComplexSelector extends Selector<SelectorValue> {
  /**
   * Essentially, a#id.class === a.class#id as being identical selectors,
   * so we normalize groups and combinators to be in Immutable Sets,
   * which ignores order when comparing
   *
   * @note sequences return the same tuple structure as lists,
   *       because :is() and :where() can resolve to lists
   *
   *  e.g. .class#id > a
   *   -> #[#['.class', '#id'], '>', #['a']]
   *
   *  e.g. :is(a, b, c) d, #is(e > f) g {}
   *   -> #[
   *         #[ #[ #['a'], #['b'], #['c'] ], #['d'] ],
   *         #[ #['e', '>', 'f'], #['g'] ]
   *      ]
   */
  toNormalPrimitive() {
    const { value } = this
    let elLength = value.length
    let list: Array<string | tuple | Combinator> = []
    for (let i = 0; i < elLength; i++) {
      const el = value[i]!
      const val = el.value
      /** Given .a > :is(.b.c), result should be .a > .b.c */
      if (
        el instanceof PseudoSelector
        && el.name === ':is'
        && !isNode(val, 'SelectorList')
      ) {
        /**
         * Merge :is-list into this sequence
         * @note If :is() starts with a combinator, it's relative
         * to the parent selector, so it can't be merged into the
         * current sequence.
         */
        if (val instanceof ComplexSelector && !(val.value[0] instanceof Combinator)) {
          list.push(...val.value.map(v => v.toNormalPrimitive()))
        } else {
          /** :is contains a selector of some kind */
          list.push((val as Selector).toNormalPrimitive())
        }
      } else {
        if (el instanceof Combinator) {
          list.push(el)
        } else {
          list.push(el.toNormalPrimitive())
        }
      }
    }

    if (list.length > 1) {
      const finalList: Array<string | tuple> = []
      const compoundList: Array<string | tuple<string | tuple>> = []

      const pushCompound = () => {
        if (compoundList.length > 0) {
          finalList.push(Tuple.from(compoundList.sort()))
          compoundList.length = 0
        }
      }

      for (let el of list) {
        if (el instanceof Combinator) {
          pushCompound()
          finalList.push(el.value)
        } else {
          compoundList.push(el)
        }
      }
      pushCompound()
      return Tuple.from(finalList)
    }
    return Tuple.from(list as Array<string | tuple>)
  }

  /**
   * @todo - Can we do this without Tuples?
   */
  compare(other: Node) {
    if (other instanceof ComplexSelector || other instanceof Selector) {
      const firstSelector = other instanceof ComplexSelector
        ? other.value[0]
        : other
      if (!firstSelector) {
        return undefined
      }

      const thisNormal = this.toNormalPrimitive()
      const otherNormal = other instanceof ComplexSelector
        ? other.toNormalPrimitive()
        : Tuple([other.toNormalPrimitive()])

      if (thisNormal === otherNormal) {
        return 0
      }

      const { isTuple } = Tuple

      /** Find partial matches */
      for (let i = 0; i < otherNormal.length; i++) {
        const el = otherNormal[i]!
        if (isTuple(el)) {
          const thisEl = thisNormal[i]
          if (!thisEl) {
            /** Not even a partial match */
            return undefined
          }
        }
      }
      return compare(this.toNormalPrimitive(), other.toNormalPrimitive())
    }
    return super.compare(other)
  }

  /**
   * @todo - Re-write and simplify, now that we have a distinct CompoundSelector
   */
  async eval(context: Context): Promise<ComplexSelector | SelectorList | Nil> {
    let selector: ComplexSelector = this.clone()
    let elements = [...selector.value] as SelectorValue
    selector.value = elements

    let collapseNesting = context.opts.collapseNesting
    if (collapseNesting) {
      let hasAmp = elements.find(el => el instanceof Ampersand)
      /**
       * Try to evaluate all selectors as if they are prepended by `&`
       *
       * @todo - An initial plain identifier should be wrapped in `:is()`
       * for outputting to CSS -- this is done in the ToCssVisitor?
       *
       * @todo - we should not push an ampersand if we're not collapsing nesting
       */
      if (!hasAmp && context.frames.length > 0) {
        if (elements[0] instanceof Combinator) {
          elements.unshift(new Ampersand())
        } else {
          elements.unshift(new Ampersand(), new Combinator(' '))
        }
      }
    }

    selector = await super.eval.call(selector, context) as ComplexSelector

    let cleanElements = (elements: Array<Selector | Combinator | Nil>): SelectorValue => {
      let elementsLength = elements.length
      for (let i = 0; i < elementsLength; i++) {
        let value = elements[i]!

        if (
          i === 0
          && (
            (
              value instanceof ComplexSelector
              && value.value.length === 0
            )
            || value instanceof Nil
            || (collapseNesting && (value instanceof Ampersand || value instanceof Combinator))
          )
        ) {
          elements.shift()
          elementsLength -= 1
          i -= 1
        /**
         * @note The following two can occur because of evaluation of `&`
         */
        } else if (value instanceof ComplexSelector) {
          elements = elements.slice(0, i).concat(value.value).concat(elements.slice(i + 1))
          elementsLength += value.value.length - 1
        } else if (isNode(value, 'SelectorList') && elementsLength > 1) {
          /**
           * Wrap returned lists with :is(), if
           * there are more elements in the sequence
           */
          elements[i] = new PseudoSelector([
            ['name', ':is'],
            ['value', value]
          ])
        }
      }
      return elements as SelectorValue
      // This can/should only happen with compound selectors
      // elements.sort((a, b) => {
      //   const aVal = a instanceof BasicSelector && a.isTag ? -1 : 0
      //   const bVal = b instanceof BasicSelector && b.isTag ? -1 : 0
      //   return aVal - bVal
      // })
    }

    if (isNode(selector, 'SelectorList')) {
      (selector as SelectorList).value.forEach(sel => { (sel).value = cleanElements(sel.value) })
    } else {
      selector.value = cleanElements(selector.value)
    }

    if (elements.length === 0) {
      return new Nil()
    }
    return selector
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

export const sel = defineType(ComplexSelector, 'ComplexSelector', 'sel')