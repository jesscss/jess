import { Node, Str } from '.'
import type { JsExpr } from './js-expr'
import type { Context } from '../context'
import { ILocationInfo, isNodeMap, NodeMap } from './node'
import { OutputCollector } from '../output'

export class Element extends Node {
  value: Str | JsExpr

  constructor(
    value: string | Str | JsExpr | NodeMap,
    location?: ILocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    }
    super({
      value: value.constructor === String ? new Str(value) : value
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

  toCSS(context: Context, out: OutputCollector) {
    if (this.isClass) {
      out.add(context.hashClass(this.value.value), this.location)
    } else {
      out.add(this.value.value, this.location)
    }
  }

  toModule(context: Context, out: OutputCollector) {
    const loc = this.location
    out.add(`J.el(`, loc)
    this.value.toModule(context, out)
    out.add(')')
  }
}

export const el =
  (...args: ConstructorParameters<typeof Element>) => new Element(...args)