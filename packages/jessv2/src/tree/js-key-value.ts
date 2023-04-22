import { JsNode } from './js-node'
import { JsIdent } from './js-ident'
import { JsCollection } from './js-collection'
import type { Node, LocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'


export type JsKeyValueValue = {
  name: JsIdent | string
  value: Node
}

/**
 * Either the left-hand side of a @let assignment,
 * or the key (prop) in a collection.
 * 
 * @todo - technically we don't need to limit
 * reserved words in object properties, just
 * initial @let identifiers
 */
export class JsKeyValue extends JsNode {
  name: JsIdent
  value: Node

  constructor(
    val: JsKeyValueValue,
    location?: LocationInfo
  ) {
    let { name, value } = val
    if (name.constructor === String) {
      name = new JsIdent(name)
    }
    super({ name, value }, location)
  }

  toCSS(context: Context, out: OutputCollector) {
    const value = this.value
    out.add(this.name.value, this.location)
    if (!(value instanceof JsCollection)) {
      out.add(':')
    }
    out.add(' ')
    value.toCSS(context, out)
    if (!(value instanceof JsCollection)) {
      out.add(';')
    }
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`${this.name.value}: `, this.location)
    this.value.toModule(context, out)
  }

}
JsKeyValue.prototype.type = 'JsKeyValue'

export const keyval =
  (value: JsKeyValueValue, location?: LocationInfo) =>
    new JsKeyValue(value, location)