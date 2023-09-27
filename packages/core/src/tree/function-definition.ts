import { type Context } from '../context'
import { AtRule } from './at-rule'
import { defineType } from './node'
import { Ruleset } from './ruleset'
import type { Node } from './node'
import { BaseDeclaration, type Name } from './base-declaration'
import { type VarDeclarationOptions } from './var-declaration'

/**
 * Functions are mixins with a return value
 *
 * @todo - Allow this to be applied to external JS functions
 */
export class FunctionDefinition extends BaseDeclaration<Name, MixinBody<T>, VarDeclarationOptions> {
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