import type { Context } from '../context'
import { Node, defineType } from './node'
import { Ruleset } from './ruleset'
import { Root } from './root'
import { Call } from './call'

export type IncludeValue = {
  value: Node
  with?: Ruleset
}

/**
 * Include can be for a file or a mixin
 * or a variable that returns a ruleset.
 *
 * Basically anything that returns a ruleset.
 */
export class Include extends Node<IncludeValue> {
  async eval(context: Context): Promise<Node> {
    let value = this.value
    if (value instanceof Call) {
      value = await value.eval(context)
    }

    /**
     * Convert included objects into declaration sets
     * @todo - replace now that we're not pre-converting
     * into a module
     */
    // if (isPlainObject(value)) {
    //   let rules: Node[] = []
    //   for (let name in value) {
    //     if (Object.prototype.hasOwnProperty.call(value, name)) {
    //       rules.push(new Declaration({
    //         name,
    //         value: context.cast((value[name])).eval(context)
    //       }))
    //     }
    //   }
    //   return new Ruleset(rules)
    // }

    // value = context.cast(value).eval(context)

    /**
     * Include Roots as plain Rulesets
     * @todo - add fileInfo
     */
    if (value instanceof Root) {
      return new Ruleset(value.value).inherit(this)
    }

    if (!value.allowRoot && !value.allowRuleRoot) {
      let message = '@include returned an invalid node.'
      if (value instanceof Call) {
        message += ` Unknown reference "${value.name}"`
      }
      throw new TypeError(message)
    }
    return value.inherit(this)
  }

  /** Move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.include(')
  //   this.value.toModule(context, out)
  //   out.add(')')
  // }
}

export const include = defineType(Include, 'Include')