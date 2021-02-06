import { Expression } from './expression'
import { Combinator } from './combinator'
import { Ampersand } from './ampersand'
import { WS } from './ws'
import { isNodeMap } from './node'
import type { Node, NodeMap, LocationInfo } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

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
export class Selector extends Expression {
  
  constructor(
    value: (string | Node)[] | NodeMap,
    location?: LocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    }
    const values = value.map(v => v.constructor === String ? new Combinator(v) : v)
    super({
      value: values
    }, location)
  }

  eval(context: Context) {
    let selector: Selector = this.clone()
    let elements = [...selector.value]
    selector.value = elements
    
    const hasAmp = elements.find(el => el instanceof Ampersand)
    /**
     * Try to evaluate all selectors as if they are prepended by `&`
     */
    if (!hasAmp) {
      if (elements[0] instanceof Combinator) {
        elements.unshift(new Ampersand())
      } else {
        elements.unshift(new Ampersand(), new Combinator(' '))
      }
    }

    selector = super.eval.call(selector, context)
    elements = selector.value

    for (let i = 0; i < elements.length; i++) {
      let value = elements[0]
      if (
        value instanceof Combinator ||
        value instanceof WS
      ) {
        elements.shift()
      } else {
        break
      }
    }
    return selector
  }

  toCSS(context: Context, out: OutputCollector) {
    this.value.forEach(node => node.toCSS(context, out))
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.sel([`, this.location)
    const length = this.value.length - 1
    this.value.forEach((node, i) => {
      node.toModule(context, out)
      if (i < length) {
        out.add(', ')
      }
    })
    out.add(`])`)
  }
}
Selector.prototype.type = 'Selector'

export const sel =
  (value: (string | Node)[] | NodeMap, location?: LocationInfo) =>
    new Selector(value, location)