import { Node, JsNode, JsCollection } from '.'
import { LocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'


export type JsKeyValueValue = {
  name: string
  value: Node
}

export const JsReservedWords = [
  'abstract', 'arguments',
  'await', 'boolean',
  'break', 'byte',
  'case', 'catch',
  'char', 'class',
  'const', 'continue',
  'debugger', 'default', 
  'delete', 'do',
  'double', 'else',
  'enum', 'eval',
  'export', 'extends',
  'false', 'final',
  'finally', 'float', 
  'for', 'function',
  'goto', 'if',
  'implements', 'import',
  'in', 'instanceof',
  'int', 'interface',
  'let', 'long', 
  'native', 'new',
  'null', 'package',
  'private', 'protected',
  'public', 'return',
  'short', 'static',
  'super', 'switch',
  'synchronized', 'this',
  'throw', 'throws',
  'transient', 'true',
  'try', 'typeof',
  'var', 'void',
  'volatile', 'while',
  'with', 'yield'
]

/**
 * Either the left-hand side of a @let assignment,
 * or the key (prop) in a collection.
 * 
 * @todo - technically we don't need to limit
 * reserved words in object properties, just
 * initial @let identifiers
 */
export class JsKeyValue extends JsNode {
  name: string
  value: Node

  constructor(
    value: JsKeyValueValue,
    location?: LocationInfo
  ) {
    const name = value.name
    if (name.includes('-')) {
      throw {
        message: 'Dashes are not allowed in JS identifiers.'
      }
    }
    if (JsReservedWords.includes(name)) {
      throw {
        message: `'${name}' is a reserved word.`
      }
    }
    super(value, location)
  }

  toCSS(context: Context, out: OutputCollector) {
    const value = this.value
    out.add(this.name, this.location)
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
    out.add(`${this.name}: `, this.location)
    this.value.toModule(context, out)
  }

}

export const keyval =
  (value: JsKeyValueValue, location?: LocationInfo) =>
    new JsKeyValue(value, location)