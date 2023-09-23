import { Combinator } from './combinator'
import { Ampersand } from './ampersand'
import {
  defineType,
  Node
} from './node'
import type { Context } from '../context'
import { Nil } from './nil'
import { type SimpleSelector } from './selector-simple'
import { BasicSelector } from './selector-basic'
import { isNode } from './util'
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
  async eval(context: Context): Promise<SelectorSequence | SelectorList | Nil> {
    let selector: SelectorSequence = this.clone()
    let elements = [...selector.value]
    selector.value = elements

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

    selector = await super.eval.call(selector, context) as SelectorSequence

    let cleanElements = (elements: Node[]) => {
      let elementsLength = elements.length
      for (let i = 0; i < elementsLength; i++) {
        let value = elements[0]
        if (
          (
            value instanceof SelectorSequence &&
            value.value.length === 0
          ) ||
          value instanceof Nil ||
          value instanceof Combinator
        ) {
          elements.shift()
          elementsLength -= 1
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
      elements.sort((a, b) => {
        const aVal = a instanceof BasicSelector && a.isTag ? -1 : 0
        const bVal = b instanceof BasicSelector && b.isTag ? -1 : 0
        return aVal - bVal
      })
    }

    if (isNode(selector, 'SelectorList')) {
      selector.value.forEach(sel => { cleanElements(sel.value) })
    } else {
      cleanElements(selector.value)
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