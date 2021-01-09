import { Expression, Str } from '.'
import type { Node, NodeMap, ILocationInfo } from './node'
import type { Context } from '../context'

/**
 * @example
 * #id > .class.class
 * 
 * Stored as:
 * [Element, '>', Element, Element]
 */
export class Selector extends Expression {
  toString() {
    let out = ''
    this.value.forEach(node => {
      if (node instanceof Str) {
        const val = node.value
        out += val === ' ' ? val : ` ${val} `
      } else {
        out += node.toString()
      }
    })
    return out
  }

  toModule(context: Context) {
    const nodes = this.value.map(node => node.toModule(context))
    return `J.sel([${nodes.join(', ')}])`
  }
}

export const sel =
  (value: (string | Node)[] | NodeMap, location?: ILocationInfo) =>
    new Selector(value, location)