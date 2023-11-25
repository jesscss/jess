import { Combinator } from './combinator'
import { Ampersand } from './ampersand'
import {
  defineType,
  Node
} from './node'
import type { Context } from '../context'
import { Nil } from './nil'
import { type SimpleSelector } from './selector-simple'
// import { BasicSelector } from './selector-basic'
import { isNode } from './util'
import { compareNodeArray } from './util/compare'
import { PseudoSelector } from './selector-pseudo'
import { type SelectorList } from './selector-list'

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
export class SelectorSequence extends Node<Array<SimpleSelector | Combinator>> {
  normalizedSelector() {
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
      return compareNodeArray(this.value, other.value)
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

    let cleanElements = (elements: Node[]) => {
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
      return elements
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