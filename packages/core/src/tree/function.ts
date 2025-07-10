import { type Context } from '../context'
import { AtRule } from './at-rule'
import { defineType } from './node'
import { Rules } from './rules'
import type { Node } from './node'
import { Mixin } from './mixin'

/**
 * Functions are mixins with a return value,
 * defined in a stylesheet.
 *
 *  e.g. `$my-function: @($a; $b) > { ... }`
 *
 * Used by Jess / Sass
 */
export class Func extends Mixin {
  override type = 'Func' as const
  override shortType = 'fn' as const

  override async evalNode(context: Context): Promise<Node> {
    let result = await super.evalNode(context)
    if (result instanceof Rules) {
      /** Find the last valid return */
      const decl = result.findDeclaration('return', 'Declaration', undefined, false)
      if (!decl) {
        throw new Error(`Function ${this.value.name} must return a value`)
      }
    }
    return result
  }
}

export const fn = defineType(Func, 'Func', 'fn')