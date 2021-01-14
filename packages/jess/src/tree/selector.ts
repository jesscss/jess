import { Expression, Anonymous } from '.'
import type { Node, NodeMap, ILocationInfo } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

/**
 * @example
 * #id > .class.class
 * 
 * Stored as:
 * [Element, '>', Element, Element]
 */
export class Selector extends Expression {
  toCSS(context: Context, out: OutputCollector) {
    this.value.forEach(node => {
      if (node instanceof Anonymous) {
        const val = node.value
        out.add(val === ' ' ? val : ` ${val} `, this.location)
      } else {
        node.toCSS(context, out)
      }
    })
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`_J.sel([`, this.location)
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
  (value: (string | Node)[] | NodeMap, location?: ILocationInfo) =>
    new Selector(value, location)