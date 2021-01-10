import { Node, Collection } from '.'
import type { ILocationInfo, NodeMap } from './node'
import type { Context } from '../context'

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
export class Let extends Node {
  name: string
  value: Node

  constructor(
    value: LetValue,
    location?: ILocationInfo
  ) {
    super(value, location)
  }

  toString() {
    const { name, value } = this
    if (value instanceof Collection) {
      return `@let ${this.name} ${this.value}`
    }
    return `@let ${this.name}: ${this.value};`
  }

  toModule(context: Context) {
    const name = this.name
    context.exports.add(name)
    let out = ''
    if (context.isRoot) {
      out += 'export '
    }
    out += `let ${name} = ${this.value.toModule(context)}`
    return out
  }
}

/**
 * `let` is a reserved word, so we'll use lower-case
 * "set" (even though Set is a JS thing)
 */
export const set =
  (...args: ConstructorParameters<typeof Let>) =>
    new Let(...args)
