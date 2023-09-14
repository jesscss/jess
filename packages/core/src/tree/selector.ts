import { Sequence } from './sequence'
import { Combinator } from './combinator'
import { Ampersand } from './ampersand'
import {
  defineType,
  type Node
} from './node'
import type { Context } from '../context'
import { Nil } from './nil'
import { List } from './list'
import { type Element } from './element'

/**
 * @example
 * #id > .class.class
 *
 * Stored as:
 * [Element, Combinator, Element, Element]
 *
 * @todo
 * Push an ampersand at the beginning of selector expressions
 * if there isn't one
 */
export class Selector extends Sequence<Element | Combinator | Ampersand> {
  // constructor(
  //   value: Array<string | Node> | NodeMap,
  //   location?: LocationInfo
  // ) {
  //   if (isNodeMap(value)) {
  //     super(value, location)
  //     return
  //   }
  //   const values = value.map(v => v.constructor === String ? new Combinator(v) : v)
  //   super({
  //     value: values
  //   }, location)
  // }

  eval(context: Context) {
    let selector: Selector = this.clone()
    const elements = [...selector.value]
    selector.value = elements

    const hasAmp = elements.find(el => el instanceof Ampersand)
    /**
     * Try to evaluate all selectors as if they are prepended by `&`
     *
     * @todo - An initial plain identifier should be wrapped in `:is()`
     * for outputting to CSS -- this is done in the ToCssVisitor?
     */
    if (!hasAmp && context.frames.length > 0) {
      if (elements[0] instanceof Combinator) {
        elements.unshift(new Ampersand())
      } else {
        elements.unshift(new Ampersand(), new Combinator(' '))
      }
    }

    selector = super.eval.call(selector, context)

    const cleanElements = (elements: Node[]) => {
      for (let i = 0; i < elements.length; i++) {
        const value = elements[0]
        if (
          (
            value instanceof Selector &&
            value.value.length === 0
          ) ||
          value instanceof Nil ||
          value instanceof Combinator
        ) {
          elements.shift()
        } else {
          break
        }
      }
    }

    if (selector instanceof List) {
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

export const sel = defineType(Selector, 'Selector', 'sel')