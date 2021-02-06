import { isNodeMap, NodeMap, LocationInfo } from './node'
import { JsNode } from './js-node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

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
  'undefined',
  'var', 'void',
  'volatile', 'while',
  'with', 'yield'
]

/**
 * A super-type for inheritance checks
 */
export class JsIdent extends JsNode {
  value: string
  constructor(
    value: string | NodeMap,
    location?: LocationInfo
  ) {
    let name: string
    if (isNodeMap(value)) {
      name = <string>value.value
    }
    else {
      name = value
    }
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
    super(name, location)
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(this.value)
  }
}
JsIdent.prototype.type = 'JsIdent'

export const ident =
  (value: string, location?: LocationInfo) =>
    new JsIdent(value, location)