import { type Context } from '../context'
import { AtRule } from './at-rule'
import { Mixin } from './mixin'
import { defineType } from './node'
import { Ruleset } from './ruleset'
import type { DeclarationValue } from './declaration'
import type { MixinBody } from './mixin-body'

/**
 * Functions are mixins with a return value
 *
 * @todo - Allow this to be applied to external JS functions
 */
export class FunctionDefinition extends Mixin<(...args: any[]) => any> {
  eval(context: Context) {
    const result = super.eval(context)
    if (result && result instanceof Ruleset) {
      if (result._last instanceof AtRule && result._last.name === '@return') {
        return result._last.prelude
      }
    }
    return result
  }
}

export const func = defineType<DeclarationValue<MixinBody>>(FunctionDefinition, 'FunctionDefinition')