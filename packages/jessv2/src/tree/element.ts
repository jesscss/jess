import { Anonymous } from './anonymous'
import { List } from './list'
import { Expression } from './expression'
import type { Context } from '../context'
import { Node, LocationInfo, isNodeMap } from './node'
import { OutputCollector } from '../output'

export class Element extends Node {
  value: any

  constructor(
    value: any,
    location?: LocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    }
    super({
      value: value.constructor === String ? new Anonymous(<string>value) : value
    })
  }
  
  /** Very simple string matching */
  get isAttr() {
    return /^\[/.test(this.value.value)
  }
  get isClass() {
    return /^\./.test(this.value.value)
  }
  get isId() {
    return /^#/.test(this.value.value)
  }
  get isPseudo() {
    return /^:/.test(this.value.value)
  }
  get isIdent() {
    return /^[a-z]/.test(this.value.value)
  }

  eval(context: Context) {
    const node = this.clone()
    const value = context.cast(node.value).eval(context)
    node.value = value
    // Bubble expressions and lists up to Selectors
    if (value instanceof Expression || value instanceof List) {
      return value
    }
    if (node.isClass) {
      context.hashClass(node.value.value)
    }
    return node
  }

  toCSS(context: Context, out: OutputCollector) {
    if (this.isClass) {
      out.add(context.hashClass(this.value.value), this.location)
    } else {
      out.add(this.value.value, this.location)
    }
  }

  toModule(context: Context, out: OutputCollector) {
    const loc = this.location
    out.add(`$J.el(`, loc)
    this.value.toModule(context, out)
    out.add(')')
  }
}
Element.prototype.type = 'Element'

export const el =
  (...args: ConstructorParameters<typeof Element>) => new Element(...args)