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

/**
 * This is a complex selector. However, instead of storing
 * "compound selectors" as a distinct class, we just store
 * the sequence of simple selectors and combinators.
 *
 * @example
 * #id > .class.class
 *
 * Stored as:
 * [Element, Combinator, Element, Element]
 */
export class SelectorSequence extends Selector<Array<SimpleSelector | Combinator>> {
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
  toPrimitiveSelector() {
    let { value } = this
    let length = value.length

    let groups: Array<tuple | string> = []
    let compoundSelector = []

    for (let i = 0; i < length; i++) {
      let node = value[i]!
      if (node instanceof PseudoSelector && node.value) {
        let innerValue = node.value
        if (!(isNode(innerValue, 'SelectorList'))) {
          if (isNode(innerValue, 'SelectorSequence')) {
            value.splice(i, 0, ...innerValue.value)
          } else {
            value.splice(i, 0, innerValue as SimpleSelector)
          }
        }
      }
      /**
       * @note - Combinators are not part of sorting,
       * because their order matters.
       */
      if (node instanceof Combinator) {
        if (compoundSelector.length > 0) {
          /**
           * Selectors are sorted because reversing the order
           * should not affect the comparison.
           * e.g. .class#id === #id.class
           */
          groups.push(
            Tuple.from(
              compoundSelector.map(v => v.toPrimitiveSelector()).sort()
            )
          )
          compoundSelector = []
        }
        groups.push(node.toTrimmedString())
      } else {
        compoundSelector.push(node)
      }
    }
    if (compoundSelector.length > 0) {
      groups.push(
        Tuple.from(
          compoundSelector.map(v => v.toPrimitiveSelector()).sort()
        )
      )
    }
    return Tuple.from(groups)
    /**
     *
     * So what we should do here is have a kind of tree for looking up
     * sets of selectors. Each selector should be a set (maybe?). And each
     * compound selector should be a set. Extending a single selector would
     * wrap the selector in a set. Extending a compound selector would
     * wrap the compound selector in a set. Wrapping a set with another
     * set is dependent on the extend properties.
     *
     div.class#id > em#id2.class2

     Set([
      Set(['.class', 'div', '#id']),
      '>',
      Set(['.class2', 'em', '#id2'])
     ])
     */
    // return {
    //   '.class': [
    //     [Set(['.class', 'div', '#id']), '>', Set(['.class2', 'em', '#id2'])]
    //   ],
    //   '#id': ['.class', 'div', '#id'],
    //   div: ['.class', 'div', '#id'],
    //   ['.class', 'div', '#id']: [['.class', 'div', '#id'], '>', ['.class2', 'em', '#id2']]
    // }
  }

  compare(other: Node) {
    if (other instanceof SelectorSequence) {
      return compare(this.toPrimitiveSelector(), other.toPrimitiveSelector())
    }
    return super.compare(other)
  }

  async eval(context: Context): Promise<SelectorSequence | SelectorList | Nil> {
    let selector: SelectorSequence = this.clone()
    let elements = [...selector.value]
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

    selector = await super.eval.call(selector, context) as SelectorSequence

    let cleanElements = (elements: Array<Selector | Combinator | Nil>): Array<SimpleSelector | Combinator> => {
      let elementsLength = elements.length
      for (let i = 0; i < elementsLength; i++) {
        let value = elements[i]!

        if (
          i === 0 &&
          (
            (
              value instanceof SelectorSequence &&
              value.value.length === 0
            ) || value instanceof Nil ||
            (collapseNesting && (value instanceof Ampersand || value instanceof Combinator))
          )
        ) {
          elements.shift()
          elementsLength -= 1
          i -= 1
        } else if (value instanceof SelectorSequence) {
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
      return elements as Array<SimpleSelector | Combinator>
      // This can/should only happen with compound selectors
      // elements.sort((a, b) => {
      //   const aVal = a instanceof BasicSelector && a.isTag ? -1 : 0
      //   const bVal = b instanceof BasicSelector && b.isTag ? -1 : 0
      //   return aVal - bVal
      // })
    }

    if (isNode(selector, 'SelectorList')) {
      (selector as SelectorList).value.forEach(sel => { (sel as any).value = cleanElements(sel.value) })
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

export const sel = defineType(SelectorSequence, 'SelectorSequence', 'sel')