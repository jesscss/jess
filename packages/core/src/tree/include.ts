import type { Context } from '../context'
import isPlainObject from 'lodash-es/isPlainObject'
import { Node, defineType } from './node'
import { Declaration } from './declaration'
import { Ruleset } from './ruleset'
import { Root } from './root'
import { Call } from './call'

export type IncludeValue = {
  value: Node
  with?: Ruleset
}

export class Include extends Node<IncludeValue> {
  async eval(context: Context) {
    let value = this.value
    if (value instanceof Call) {
      value = value.eval(context)
    }

    /**
     * Convert included objects into declaration sets
     * @todo - replace now that we're not pre-converting
     * into a module
     */
    if (isPlainObject(value)) {
      const rules: Node[] = []
      for (const name in value) {
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
      throw new Error(message)
    }
    return value
  }

  /** Move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.include(')
  //   this.value.toModule(context, out)
  //   out.add(')')
  // }
}

export const include = defineType(Include, 'Include')