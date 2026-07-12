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
 *  e.g. `@ function ($a, $b) { ... }`
 *
 * Used by Jess / Sass
 */
export class Func extends Mixin {
  async eval(context: Context): Promise<Node> {
    let result = await super.eval(context)
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