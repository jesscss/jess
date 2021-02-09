import type { Context } from '../context'
import type { OutputCollector } from '../output'
import isPlainObject from 'lodash/isPlainObject'
import { Node, isNodeMap, LocationInfo } from './node'
import { Declaration } from './declaration'
import { Ruleset } from './ruleset'
import { Root } from './root'
import { Call } from './call'

export class Include extends Node {
  value: any

  constructor(
    value: any,
    location?: LocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
    } else {
      super({ value }, location)
    }
  }

  eval(context: Context) {
    let value = this.value
    if (value instanceof Call) {
      value = value.eval(context)
    }

    /** Convert included objects into declaration sets */
    if (isPlainObject(value)) {
      const rules: Node[] = []
      for (let name in value) {
        if (Object.prototype.hasOwnProperty.call(value, name)) {
          rules.push(new Declaration({
            name,
            value: context.cast((value[name])).eval(context)
          }))
        }
      }
      return new Ruleset(rules)
    }

    value = context.cast(value).eval(context)

    /**
     * Include Roots as plain Rulesets
     */
    if (value instanceof Root) {
      return new Ruleset(value.value)
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
Include.prototype.type = 'Include'

export const include =
  (value: any, location?: LocationInfo) =>
    new Include(value, location)