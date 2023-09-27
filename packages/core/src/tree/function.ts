import { type Context } from '../context'
import { AtRule } from './at-rule'
import { defineType } from './node'
import { Ruleset } from './ruleset'
import type { Node } from './node'
import { BaseDeclaration, type Name } from './base-declaration'
import { type List } from './list'
import { type VarDeclaration } from './var-declaration'
import { type Rest } from './rest'

export type FunctionValue = {
  name?: Name
  params?: List<Node | VarDeclaration | Rest>
  value: Ruleset | ((...args: any[]) => any)
}

/**
 * Functions are mixins with a return value
 *
 * @todo - Allow this to be applied to external JS functions
 */
export class Func extends BaseDeclaration<FunctionValue> {
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

export const fn = defineType(Func, 'Func', 'fn')