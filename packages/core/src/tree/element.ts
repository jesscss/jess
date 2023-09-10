import { Anonymous } from './anonymous'
import { List } from './list'
import { Expression } from './expression'
import type { Context } from '../context'
import type { LocationInfo } from './node'
import { Node, isNodeMap } from './node'
import type { OutputCollector } from '../output'

/**
 * @todo attribute elements, when compared,
 * compare with a normalized value
*/
export class Element extends Node<string | Node> {
  /** Very simple string matching */
  get isAttr() {
    return /^\[/.test(this.value)
  }

  get isClass() {
    return /^\./.test(this.value)
  }

  get isId() {
    return /^#/.test(this.value)
  }

  // get isPseudo() {
  //   return /^:/.test(this.value)
  // }

  // get isIdent() {
  //   return /^[a-zA-Z-]/.test(this.value)
  // }

  eval(context: Context) {
    if (!this.evaluated) {
      const node = super.eval(context)
      if (node.isClass) {
        context.hashClass(node.value)
      }
      return node
    }
    return this
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   if (this.isClass) {
  //     out.add(context.hashClass(this.value.value), this.location)
  //   } else {
  //     out.add(this.value.value, this.location)
  //   }
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.el(', loc)
  //   this.value.toModule(context, out)
  //   out.add(')')
  // }
}
Element.prototype.type = 'Element'

export const el =
  (...args: ConstructorParameters<typeof Element>) => new Element(...args)