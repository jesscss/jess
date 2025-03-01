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
 *  e.g. `@--function ($a; $b) { ... }`
 *
 * Used by Jess / Sass
 */
export class Func extends Mixin {
  override type = 'Func' as const
  override shortType = 'fn' as const

  /**
   * @todo - this logic is incorrect. The FIRST evaluated
   * at-rule or declaration with `return` should be the return value,
   * and in fact it should immediately exit without evaluating the rest.
   * 
   * Probably don't override mixin?
   */
  override async evalNode(context: Context): Promise<Node> {
    let result = await super.evalNode(context)
    if (result instanceof Rules) {
      let value = result.value
      let last = value[value.length - 1]
      if (last instanceof AtRule && last.name.value.includes('return')) {
        return last.prelude!
      }
    }
    return result
  }
}

export const fn = defineType(Func, 'Func', 'fn')