import { Expression, Combinator, isNodeMap } from '.'
import type { Node, NodeMap, LocationInfo } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

/**
 * @example
 * #id > .class.class
 * 
 * Stored as:
 * [Element, '>', Element, Element]
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

export const sel =
  (value: (string | Node)[] | NodeMap, location?: LocationInfo) =>
    new Selector(value, location)