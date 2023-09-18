import { defineType, Node } from './node'
import type { Interpolated } from './interpolated'
import { type Context } from '../context'
import { cast } from './util/cast'

/**
 * The type is determined by syntax
 * and location.
 *   e.g. in Jess
 *    - `$foo` (or #($foo)) refers to a variable
 *    - `$.foo` (or #($.foo) refers to a property
 *    - in `@include foo()`, `foo` refers to a mixin
 *   in Less
 *   - `@foo` refers to a variable
 *   - `$foo` refers to a property
 *   - `.foo` refers to a mixin
 */
export type ReferenceOptions = {
  type: 'variable' | 'property' | 'mixin'
}
/**
 * This is a variable or property reference,
 * which can itself contain a reference.
 */
export class Reference extends Node<string | Interpolated, ReferenceOptions> {
  declare options: ReferenceOptions

  toTrimmedString(): string {
    const { type } = this.options ?? {}
    const { value } = this
    switch (type) {
      case 'variable':
        return `$${value}`
      case 'property':
        return `$.${value}`
      case 'mixin':
        return `${value}`
    }
  }

  /**
   * We don't need to mark evaluated, because a reference
   * should never resolve to another reference
   */
  async eval(context: Context) {
    let { value } = this
    let { type } = this.options
    if (value instanceof Node) {
      const resolved = await value.eval(context)
      value = resolved.value
    }
    switch (type) {
      case 'variable':
        value = context.scope.getVar(value as string)
        break
      case 'property':
        value = context.scope.getProp(value as string)
        break
      case 'mixin':
        value = context.scope.getMixin(value as string)
    }
    if (value instanceof Node) {
      return await value.eval(context)
    } else {
      return cast(value)
    }
  }
}

export const ref = defineType(Reference, 'Reference', 'ref')