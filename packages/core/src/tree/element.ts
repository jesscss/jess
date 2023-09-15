import type { Context } from '../context'
import { Node, defineType } from './node'

/**
 * An element is a simple selector
 *   e.g. div, .foo, #bar, [attr]
 *
 * @todo attribute elements, when compared,
 * compare with a normalized value
*/
export class Element extends Node<string> {
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

  async eval(context: Context) {
    if (!this.evaluated) {
      const node = await super.eval(context) as Element
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

export const el = defineType(Element, 'Element', 'el')