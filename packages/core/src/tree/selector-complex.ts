/* eslint-disable @typescript-eslint/require-array-sort-compare */
import { Combinator } from './combinator'
import { Ampersand } from './ampersand'
import {
  defineType
} from './node'
import type { Context } from '../context'
import { Nil } from './nil'
import { isNode } from './util'
import { PseudoSelector } from './selector-pseudo'
import { type SelectorList } from './selector-list'
import { Selector, type Keys } from './selector'
import type { SimpleSelector } from './selector-simple'
import type { CompoundSelector } from './selector-compound'

// TODO - fix later
export type ComplexSelectorComponent = SimpleSelector | CompoundSelector | Combinator | Ampersand
// type SelectorValue = Component[]
type SelectorValue = ComplexSelectorComponent[]
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
  valueOf() {
    let value = this._value
    if (!value) {
      value = this.value.map(n => n.valueOf()).join('')
      Object.defineProperty(this, '_value', { value })
    }
    return value
  }

  get keys() {
    let keys = this._keys
    if (!keys) {
      Object.defineProperty(this, '_keys', {
        value: keys = this.value.flatMap(n => {
          return n instanceof Combinator ? [] : n.keys
        }) as Keys
      })
    }
    return keys
  }

  toTrimmedString(depth?: number | undefined): string {
    let output = ''
    let { value } = this
    let length = value.length
    for (let i = 0; i < length; i++) {
      let component = value[i]!
      /** Add some combinator spacing */
      if (isNode(component, 'Combinator') && component.value !== ' ') {
        output += !component.pre ? ' ' : component.processPrePost('pre')
        output += component.toTrimmedString(depth)
        output += !component.post ? ' ' : component.processPrePost('post')
      } else {
        output += component.toString()
      }
    }
    return output
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

type SelectorParams = ConstructorParameters<typeof ComplexSelector>

export const sel = defineType<SelectorValue>(ComplexSelector, 'ComplexSelector', 'sel') as (
  value: SelectorValue,
  options?: SelectorParams[1],
  location?: SelectorParams[2],
  treeContext?: SelectorParams[3]
) => ComplexSelector