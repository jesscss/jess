import { Node, Declaration, Ruleset, Cast, LocationInfo } from '.'
import type { Context } from '../context'
import type { OutputCollector } from '../output'
import isPlainObject from 'lodash/isPlainObject'

export class Include extends Node {
  value: Node

  eval(context: Context) {
    const value: Node | object = this.value.eval(context)

    /** Convert included objects into declaration sets */
    if (isPlainObject(value)) {
      const rules: Node[] = []
      for (let name in value) {
        rules.push(new Declaration({
          name,
          value: new Cast(value[name]).eval(context)
        }))
      }
      return new Ruleset(rules)
    }
    
    return <Node>value
  }

  toModule(context: Context, out: OutputCollector) {
    out.add('$J.include(')
    this.value.toModule(context, out)
    out.add(')')
  }
}

export const include =
  (value: Node, location?: LocationInfo) =>
    new Include(value, location)