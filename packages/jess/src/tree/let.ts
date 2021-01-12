import { Node, Collection, JsNode } from '.'
import type { ILocationInfo, NodeMap } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

export type LetValue = NodeMap & {
  name: string
  value: Node
}

/**
 * @let
 * 
 * @note
 * The lower-case API variant for this is `set()`,
 * see the note below.
 */
export class Let extends JsNode {
  name: string
  value: Node

  constructor(
    value: LetValue,
    location?: ILocationInfo
  ) {
    const name = value.name
    /** @todo - check for dash-case or double-underscore */
    if (!name) {
      throw { message: 'Identifier required' }
    }
    super(value, location)
  }

  toString() {
    const { name, value } = this
    if (value instanceof Collection) {
      return `@let ${name} ${value}`
    }
    return `@let ${name}: ${value};`
  }

  toModule(context: Context, out: OutputCollector) {
    const name = this.name
    if (context.rootLevel === 1) {
        out.add(`let ${name} = _JESS.assign(__BK_${name}, rest.${name})`)
    } else {
      if (context.rootLevel === 0) {
        context.exports.add(name)
        out.add('export ', this.location)
      }
      out.add(`let ${name} = `)
      this.value.toModule(context, out)
      if (context.rootLevel === 0) {
        out.add(`\nlet __BK_${name} = ${name}`)
      }
    }
  }
}

/**
 * `let` is a reserved word, so we'll use lower-case
 * "set" (even though Set is a JS thing)
 */
export const set =
  (...args: ConstructorParameters<typeof Let>) =>
    new Let(...args)
