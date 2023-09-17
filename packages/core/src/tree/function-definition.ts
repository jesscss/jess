import { type Context } from '../context'
import { AtRule } from './at-rule'
import { Mixin } from './mixin'
import { defineType } from './node'
import { Ruleset } from './ruleset'
import type { Node } from './node'

/**
 * Functions are mixins with a return value
 *
 * @todo - Allow this to be applied to external JS functions
 */
export class FunctionDefinition extends Mixin<(...args: any[]) => any> {
  async eval(context: Context): Promise<Node> {
    let result = await super.eval(context)
    if (result && result instanceof Ruleset) {
      let value = result.value
      let last = value[value.length - 1]
      if (last instanceof AtRule && last.name === '@return') {
        return last.prelude
      }
    }
    return result
  }
}

export const func = defineType(FunctionDefinition, 'FunctionDefinition')