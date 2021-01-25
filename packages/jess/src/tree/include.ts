import { Node, Declaration, Ruleset, Cast, LocationInfo, Root, Call } from '.'
import type { Context } from '../context'
import type { OutputCollector } from '../output'
import isPlainObject from 'lodash/isPlainObject'

export class Include extends Node {
  value: Node

  eval(context: Context) {
    let value = this.value.eval(context)
    /**
     * Include Roots as plain Rulesets
     */
    if (value instanceof Root) {
      return new Ruleset(value.value).eval(context)
    }

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
    if (!value.allowRoot && !value.allowRuleRoot) {
      let message = '@include returned an invalid node.'
      if (value instanceof Call && this.value instanceof Call) {
        message += ` Unknown function "${value.name}"`
      }
      throw { message }
    }
    return value
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